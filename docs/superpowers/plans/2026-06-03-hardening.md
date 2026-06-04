# Airlock Hardening Plan (audit response)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Resolve the verified findings from the 2026-06-03 audit (IDE-Claude 20-finding sweep, triaged + verified by the lead). Accepted findings only; the four push-backs (#3-as-stated, #11-letter, #15, #18-severity) are documented as WONTFIX with reasoning in Task 6.

**Context the audit lacked:** several "P0" items (#4/#5/#7 and #1's substance) are limitations already discovered and JSDoc-documented during the build review pipeline — this phase upgrades them from "documented" to "handled." The genuinely new, live-confirmed defect is the terminal environment (#8), so it goes first.

**CRITICAL reminders:** ASCII-only comments in agent-core (CJS-bundled into Electron main). Never break the 96 tests. agent-core stays Electron-free. The owner's packaged app may hold the single-instance lock — build-only verification where a dev boot would contend.

---

### Task 1: Terminal environment (#8, #9)

**Files:**
- Create: `packages/agent-core/src/pty/login-env.ts`
- Create: `packages/agent-core/src/pty/login-env.test.ts`
- Modify: `packages/agent-core/src/pty/session.ts`
- Modify: `packages/agent-core/src/index.ts`
- Modify: `packages/app/src/main/index.ts` (capture once at startup)
- Modify: `packages/app/src/main/ipc.ts` (pass captured env as base)

The problem (verified live): a Finder-launched Electron app inherits launchd's minimal env — no `/opt/homebrew/bin` in PATH, empty `LANG`/`COLORTERM`/`TERM_PROGRAM`. Spawned shells are locale-broken and miss user tools.

- [ ] **Step 1: login-env.ts** — capture the user's real login-shell environment once:

```ts
import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * The user's login shell from the passwd database (NOT process.env.SHELL,
 * which is empty when the app is launched from Finder under launchd).
 */
export function loginShell(): string {
  try {
    const shell = userInfo().shell;
    if (shell && shell.length > 0) return shell;
  } catch {
    // userInfo can throw on exotic setups; fall through.
  }
  return process.env.SHELL ?? "/bin/zsh";
}

/**
 * Capture the environment a real login+interactive shell would have, by
 * running it once and dumping env. Finder-launched apps inherit launchd's
 * impoverished env (no homebrew PATH, no LANG); this recovers the user's
 * actual PATH, locale, etc. Returns a delta to layer over process.env.
 * Best-effort: on any failure returns {} so the caller falls back to
 * process.env unchanged.
 */
export async function captureLoginEnv(): Promise<Record<string, string>> {
  const shell = loginShell();
  try {
    // -i -l -c with a unique delimiter so we can parse robustly. `env -0`
    // would be ideal but not all shells expose it; use newline-split and
    // accept that values with embedded newlines are rare in env.
    const { stdout } = await exec(shell, ["-ilc", "env"], {
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const out: Record<string, string> = {};
    for (const line of stdout.split("\n")) {
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      out[key] = line.slice(eq + 1);
    }
    return out;
  } catch {
    return {};
  }
}
```

- [ ] **Step 2: login-env.test.ts** (TDD — these run in vitest under the real shell):

```ts
import { describe, expect, it } from "vitest";
import { captureLoginEnv, loginShell } from "./login-env";

describe("loginShell", () => {
  it("returns an absolute shell path", () => {
    const s = loginShell();
    expect(s.startsWith("/")).toBe(true);
  });
});

describe("captureLoginEnv", () => {
  it("captures PATH and HOME from the login shell", async () => {
    const env = await captureLoginEnv();
    // A login shell always has PATH and HOME; if capture failed it returns {},
    // which would fail this assertion and correctly signal a broken capture.
    expect(env.PATH).toBeTruthy();
    expect(env.HOME).toBeTruthy();
  }, 10_000);

  it("only includes valid env var names", async () => {
    const env = await captureLoginEnv();
    for (const key of Object.keys(env)) {
      expect(key).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    }
  }, 10_000);
});
```

- [ ] **Step 3: session.ts** — accept a `baseEnv` and a better shell default:

Change `PtyOptions` to add `baseEnv?: Record<string, string>`. In the constructor, shell becomes `opts.shell ?? loginShell()` (import from "./login-env"), and env becomes `{ ...process.env, ...opts.baseEnv, ...opts.env }` so: process.env (floor) ← captured login env ← per-call injection. Also set `TERM_PROGRAM: "Airlock"` into the merged env (after the spread). Keep ASCII.

- [ ] **Step 4: index.ts** — export `captureLoginEnv`, `loginShell`.

- [ ] **Step 5: main/index.ts** — capture once at startup, hold in a module variable:

```ts
import { captureLoginEnv } from "@airlock/agent-core";
// ...
let loginEnv: Record<string, string> = {};
app.whenReady().then(async () => {
  loginEnv = await captureLoginEnv();
  registerIpc(() => loginEnv);   // pass an accessor (see Task note)
  createWindow();
});
```

Adjust `registerIpc` signature to take a `getBaseEnv: () => Record<string, string>` accessor (simplest: module-level in ipc.ts set via a small setter, OR pass into registerIpc). Choose the minimal wiring; document which.

- [ ] **Step 6: ipc.ts** — in `pty:create`, pass `baseEnv: getBaseEnv()` into `createPtySession({ ..., baseEnv })`. The secret-injection path is unchanged and still layers on top (and `filterDangerousEnv` still strips injected PATH etc — the captured login PATH is the legitimate base and is NOT filtered).

- [ ] **Step 7: verify** — `npm test` (99: 96 + 3 login-env), typecheck, lint. Build-only (do NOT launch — owner's app may hold the lock): `npm run build`. Report whether the login-env tests actually captured PATH (proves the mechanism on this machine).

- [ ] **Step 8: commit** — `fix(app): capture login-shell env for terminals (homebrew PATH, locale, TERM_PROGRAM)`

---

### Task 2: Terminal lifecycle (#14, #10, #11)

**Files:**
- Modify: `packages/app/src/renderer/src/components/TerminalPane.tsx`
- Modify: `packages/app/src/main/ipc.ts`

- [ ] **Step 1: #14 lost-output race.** Today main wires `s.onData → wc.send` synchronously inside `pty:create` (before returning the id), but the renderer only subscribes in the `.then` after the id arrives — early shell output is sent before the renderer listens and is dropped. Fix renderer-side in TerminalPane: subscribe to `onPtyData`/`onPtyExit` BEFORE/independently of knowing the id, buffering by id. Concretely, restructure the effect so a single pair of listeners is registered immediately on mount, holding the resolved id in a ref and filtering once known; OR keep a small pre-id buffer:

```tsx
    let ptyId: string | null = null;
    const pending: string[] = [];   // data that arrives before we know our id is impossible
    // Better: register listeners first, gate on a ref.
```

Preferred implementation (register-first): attach `onPtyData`/`onPtyExit` immediately on mount; each callback checks `e.id === idRef.current`. Set `idRef.current = id` inside the ptyCreate `.then` (and still handle the disposed/late-resolve kill). This guarantees no window between main forwarding and renderer subscribing. Keep the existing `disposed` late-resolve kill and unmount-kill paths intact.

(Main-side note: there is still a sub-millisecond window where main forwards before the renderer's listener is attached at the IPC layer; to fully close it, the cleanest fix is to have `pty:create` NOT attach `s.onData` until the renderer acknowledges — but that is a larger protocol change. The register-first renderer fix closes the *practical* window because listeners attach synchronously on mount, before the `ptyCreate` invoke even resolves. Document this residual as acceptable.)

- [ ] **Step 2: #14 resize debounce.** Wrap the ResizeObserver callback in a trailing debounce (~50ms) so a window drag doesn't fire dozens of `fit()` + `ptyResize` IPC calls. Keep the 0×0 hidden-pane guard. Minimal inline debounce (no new dep).

- [ ] **Step 3: #14 reject cleanup.** The `ptyCreate().catch(console.error)` leaves a dead terminal with no pty on rejection — additionally `removeTerminal(terminalId)` in the catch so a failed spawn doesn't leave a zombie tab.

- [ ] **Step 4: #10 flow control.** In `main/ipc.ts` `createPtySession` call path, enable node-pty flow control: the PtySession spawn options support `handleFlowControl: true`. Add it (thread through PtyOptions as `handleFlowControl?: boolean` defaulting true for command/interactive PTYs, OR set it unconditionally in session.ts spawn opts). When true, the renderer can send the XOFF/XON markers — but the simplest backpressure win is just enabling it so node-pty pauses the child on buffer pressure. Set `handleFlowControl: true` in session.ts spawn options. Verify the 96+ tests (PtySession tests) still pass — the marker strings default to XOFF/XON and won't appear in normal output.

- [ ] **Step 5: #11 dispose listeners (NOT destroy — node-pty has no destroy()).** In `main/ipc.ts`, the `s.onData`/`s.onExit` registrations return IDisposables that are currently discarded. Capture them and dispose in the `onExit` cleanup (and they're killed with the pty anyway, but explicit disposal is the correct hygiene the audit's #11 was reaching for). Small.

- [ ] **Step 6: verify** — typecheck, tests (PtySession suite must stay green), lint, build. Commit — `fix(app): close terminal output race, debounce resize, flow control + listener disposal`

---

### Task 3: Broker hardening (#1, #2, #4, #5, #7, #3)

**Files:**
- Modify: `packages/agent-core/src/broker/broker.ts`
- Modify: `packages/agent-core/src/broker/keychain.ts`
- Modify: `packages/agent-core/src/broker/meta.ts`
- Modify: `packages/agent-core/src/broker/broker.test.ts`
- Modify: `packages/app/src/main/ipc.ts` (#3 scrub)

- [ ] **Step 1: #1 reserved names at store time.** In `setSecret`, after `validateSecretName`, reject names that `filterDangerousEnv` would strip — reuse the dangerous set. Add to broker.ts: import the predicate (extract `isDangerousEnvName(name): boolean` from dangerous.ts) and `if (isDangerousEnvName(name)) throw new Error(...reserved...)`. Add a test: `setSecret(root, "PATH", ...)` rejects with /reserved/i. This makes the confusing silent-never-injected case an explicit error.

- [ ] **Step 2: #2 0o600 meta.** In meta.ts `writeMetaList`, `writeFile(tmp, ..., { encoding: "utf8", mode: 0o600 })`. (Also apply 0o600 to config.json write in Task 4.) Test: stat the written secrets.json, assert `(mode & 0o777) === 0o600`. Note in a comment: names-only index, but least-privilege anyway.

- [ ] **Step 3: #5 keychain error distinction.** In keychain.ts, the system `get` currently catches and returns null for both not-found and access errors. @napi-rs/keyring throws distinguishable errors. Change `KeychainStore.get` to allow signaling an access error: simplest non-breaking approach — add an optional `getStrict?(service, account): string | null` is over-engineering; instead have systemKeychain.get rethrow on errors that are NOT not-found, and return null only for the genuine not-found case. The not-found error from @napi-rs/keyring is a specific message/type — match it (e.g. /no.*entry|not found/i on the error message); anything else rethrows. Then in `injectInto`, a thrown access error propagates (caught at the pty:create injection try/catch from the secrets phase, which degrades to a secrets-less terminal AND now we can log "keychain locked" distinctly). Add a fake-keychain test where get throws a non-not-found error and assert injectInto rejects (or surfaces it) rather than silently treating as missing.

- [ ] **Step 3b: #4 surface delete failure.** In `deleteSecret`, check `keychain.delete(...)` return; if it returns false AND the meta entry existed (so it should have been present), still remove meta + audit but include `kept_in_keychain: true` in the audit detail and throw/return a soft warning. Minimal: capture the boolean, pass it to the audit detail (`{ name, keychainDeleted: result }`), and if false, also log a main-side warning. Don't hard-fail the meta removal (the user wants it gone from the list). Test: fake keychain whose delete returns false → audit detail records keychainDeleted:false.

- [ ] **Step 4: #7 meta-before-keychain.** In `setSecret`, reorder so meta is written BEFORE the keychain set is committed? No — that risks a meta entry with no value. Reconsider per the lead's note: the gentler failure is "shows in list, inject skips as missing" (meta without value) vs "silent orphan in keychain" (value without meta). So write meta FIRST, then keychain. If keychain.set throws, the meta entry exists but inject will report it missing (already handled, gentle) — and the user sees it in the list to retry/delete. Reorder: validate → upsertMeta → keychain.set → audit. If keychain.set throws after meta upsert, the meta is already persisted (acceptable degrade). Update the existing setSecret test if it asserts ordering (it shouldn't — it asserts end state). Verify all broker tests stay green.

- [ ] **Step 5: #3 scrub error log.** In `main/ipc.ts` the `pty:create` injection `console.error(..., err)` — change to log `err instanceof Error ? err.message : String(err)` (message only, no stack/object) so no structured error payload can carry env material into logs. (The lead verified the secrets handlers themselves don't log — this is the one log in the injection path, hardened defensively.)

- [ ] **Step 6: verify** — full suite (new broker tests added; report total), typecheck, lint, build. Commit — `fix(agent-core): reserved-name block, 0o600 meta, keychain error surfacing, write-order, log scrub`

---

### Task 4: Audit + config robustness (#6, #16, #20)

**Files:**
- Modify: `packages/agent-core/src/audit/audit.ts`
- Modify: `packages/agent-core/src/audit/audit.test.ts`
- Modify: `packages/agent-core/src/project/config.ts`
- Modify: `packages/agent-core/src/broker/broker.ts`

- [ ] **Step 1: #6 corrupt-line tolerance.** In `audit.ts` `readEntries`, wrap the per-line `JSON.parse` in try/catch: a line that fails to parse makes the chain INVALID (so `verifyAuditChain` returns false) rather than throwing. Simplest: have `readEntries` collect a `corrupt` flag, and `verifyAuditChain` return false if any line failed to parse. For `readAudit` (display), skip unparseable lines (best-effort display) but `verifyAuditChain` treats them as integrity failure. Add a test: append 2 entries, corrupt the JSON of line 1 (not just a field — make it invalid JSON), assert `verifyAuditChain` returns **false** (not throws) and `readAudit` does not throw.

- [ ] **Step 2: #16 config warn.** In `config.ts` `readProjectConfig`, distinguish ENOENT (return defaults silently — normal) from a parse error (return defaults BUT `console.warn` that the config file is malformed and was ignored). Keep returning defaults so the app works; just stop hiding the user's typo.

- [ ] **Step 3: #20 importDotEnv audit honesty.** In `broker.ts` `importDotEnv`, if `setSecret` throws mid-loop, the loop aborts and the `secret.import` summary audit never writes (though some `secret.set` entries did). Wrap the per-item `setSecret` in try/catch: on failure, push the name to `skipped` (or a new `failed` list) and continue; always write the import summary at the end with accurate imported/skipped/failed counts. This makes the audit trail truthful even on partial failure. Update the import test to cover a mid-loop failure (fake keychain that throws on the 2nd name) → summary records 1 imported, 1 failed, file NOT deleted (deleteAfter already gates on zero skips; extend to zero failures too).

- [ ] **Step 4: verify** — suite, typecheck, lint, build. Commit — `fix(agent-core): audit tolerates corrupt lines, config warns on malformed, honest partial-import audit`

---

### Task 5: App lifecycle (#12, #13)

**Files:**
- Modify: `packages/app/src/main/index.ts`

- [ ] **Step 1: #13 single-instance lock.** At the very top of app setup, `const gotLock = app.requestSingleInstanceLock(); if (!gotLock) { app.quit(); }` else wire `app.on("second-instance", () => { focus existing window })`. Prevents two Airlocks contending over the same project's `.airlock/` files.

- [ ] **Step 2: #12 darwin lifecycle.** Replace the unconditional `window-all-closed → app.quit()` with the standard macOS guard: `if (process.platform !== "darwin") app.quit();`. Add `app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); })` so the dock icon reopens a window. (This reverses the skeleton-era choice; the app is now stateful enough — terminals, secrets, git — to warrant staying alive.)

- [ ] **Step 3: verify** — typecheck, tests, lint, build (do NOT launch — single-instance lock would either fail against the owner's running app or displace it; build-only). Confirm the navigation guards + sandbox from earlier phases are untouched. Commit — `fix(app): single-instance lock + macOS window lifecycle (darwin guard, activate)`

---

### Task 6: Polish + WONTFIX documentation (#17, #18, #19, #15, #11-letter)

**Files:**
- Modify: `packages/agent-core/src/broker/dotenv.ts` (#17)
- Modify: `packages/agent-core/src/broker/validators.ts` (#18 light)
- Modify: `packages/app/src/main/ipc.ts` (#19 if genuinely missing guards)
- Create: `docs/superpowers/audit-2026-06-03-disposition.md` (WONTFIX record)

- [ ] **Step 1: #17 dotenv escapes.** In the double-quote branch of `parseDotEnv`, also unescape `\t` → tab, `\r` → CR, `\\` → backslash (in addition to `\n`, `\"`). Add a test line. Keep single-quote literal.

- [ ] **Step 2: #18 postgres regex tighten (light).** Tighten only the postgres password class to not greedily allow `@` mid-password where it breaks parsing — but keep it advisory. Minimal: document in a comment that validators are ADVISORY (never gate storage). Do NOT over-invest — one regex nudge + the comment.

- [ ] **Step 3: #19 IPC guards.** Audit the handlers the finding cited (fs:listDir/readFile at 44/48). They pass relPath unguarded to agent-core, which contains via resolveWithin (path.resolve coerces non-strings; resolveWithin throws on escape). Add a `typeof relPath === "string"` guard for defense-in-depth + a clean error, matching the other handlers' pattern. Only where genuinely missing.

- [ ] **Step 4: WONTFIX doc** — write `docs/superpowers/audit-2026-06-03-disposition.md` recording the full disposition of all 20 findings (accepted+commit, or WONTFIX+reasoning). The four push-backs documented precisely:
  - #3 (as stated): secrets handlers don't log; the one injection log carries an error that can't hold a value; scrubbed defensively anyway.
  - #11 (letter): node-pty has no `destroy()`; `kill()` is teardown; addressed the real intent (dispose listeners) instead.
  - #15: `git show rev:path` is not a pathspec; `--` doesn't apply; resolveWithin already validates. No change.
  - #18 (severity): validators are advisory-only; ~zero security impact; light touch only.

- [ ] **Step 5: verify** — suite, typecheck, lint, build. Commit — `fix(agent-core): dotenv escapes, advisory-validator note, IPC guards; document audit disposition`

---

### Task 7: Spec note + full verify + repackage

- [ ] Spec §7 (threat model): note the hardening pass — reserved-name blocking, keychain-error surfacing, 0o600, single-instance, login-env capture; reaffirm the documented two-store crash-window and truncation limits.
- [ ] Full verify: all tests green (report total), typecheck, lint, `npm run build`, `npm run package`. Do NOT launch (owner's app + single-instance lock). 
- [ ] Commit (NO tag): `docs: hardening phase complete; repackaged`
- [ ] **HUMAN GATE:** quit the running airlock; launch the fresh package; confirm: terminal now has homebrew PATH + locale (`echo $PATH`, `locale`); `cat` a big file doesn't hang the UI; first prompt always appears; vaulting a secret named PATH is rejected; second launch focuses the existing window instead of fighting; closing the window keeps the app alive (dock reopen). Verdict → tag hardening-v0.6 + merge.

---

## Self-review

1. All ACCEPTED findings mapped to a task; the four push-backs documented in Task 6 Step 4 with reasoning, not silently dropped.
2. Ordering matches the lead's reorder: env (#8) first as the confirmed live defect, then lifecycle, then the documented-known broker edges.
3. agent-core stays Electron-free (login-env uses node:child_process, not electron); ASCII-only; tests grow, never regress.
4. The #8 env capture composes with secret injection (layers on top) and filterDangerousEnv (strips only injected names, not the legitimate captured PATH) — explicitly noted in Task 1 Step 6.
5. Build-only verification where the single-instance lock or owner's running app would interfere; human gate does the interactive pass.
