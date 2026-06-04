# Audit 2026-06-03 - Disposition of All 20 Findings

Source: IDE-Claude 20-finding security/robustness sweep, triaged and verified by
the lead. This document records the final disposition of every finding from the
hardening pass (branch `feat/hardening`). Each finding is either ACCEPTED (with
the task and commit that resolved it) or WONTFIX / REFRAMED (with reasoning).

Sixteen findings were accepted and fixed across Tasks 1-6. Four were pushed back
with reasoning: #3 (as stated), #11 (the literal `destroy()` ask), #15, and the
severity framing of #18. None were silently dropped.

Commit map (chronological, `feat/hardening`):

| Commit    | Subject                                                                            |
| --------- | ---------------------------------------------------------------------------------- |
| `f0e9a92` | fix(app): capture login-shell env for terminals (homebrew PATH, locale, TERM_PROGRAM) |
| `a030268` | fix(app): close terminal output race, debounce resize, flow control + listener disposal |
| `7ecceb3` | fix(app): buffer pre-id terminal output; real renderer-side flow control           |
| `c10abb6` | fix(agent-core): reserved-name block, 0o600 meta, keychain error surfacing, write-order, log scrub |
| `5cb2a0d` | fix(agent-core): audit tolerates corrupt lines, config warns on malformed, honest partial-import audit |
| `e8eee8b` | fix(app): surface import failures in the Secrets status line                        |
| `4ad78fd` | fix(app): single-instance lock + macOS window lifecycle (darwin guard, activate)   |
| f07481a   | fix(agent-core): dotenv escapes, advisory-validator note, IPC guards; document audit disposition |
| `776ddaa` | docs: hardening phase complete (threat-model note, root build script); repackaged |

---

## Per-finding disposition

### #1 - Reserved env names accepted at store time (silent never-injected)
ACCEPTED. Task 3, commit `c10abb6`. `setSecret` now rejects names that
`filterDangerousEnv` would strip (via `isDangerousEnvName`), turning a confusing
silent "stored but never injected" case into an explicit `/reserved/i` error.

### #2 - secrets meta index not written with restrictive permissions
ACCEPTED. Task 3, commit `c10abb6`. `writeMetaList` (and the config write in
Task 4) now write with `mode: 0o600`. It is a names-only index, but
least-privilege applies anyway; a test stats the file and asserts
`(mode & 0o777) === 0o600`.

### #3 - "Secrets leak into logs" (AS STATED: WONTFIX / REFRAMED; defensive scrub applied)
REFRAMED. Task 3, commit `c10abb6`. The claim is incorrect as stated: the
secrets IPC handlers do NOT log errors. The single `console.error` in the area
is in `pty:create`'s injection path and carries an `injectInto` error that
structurally cannot hold a secret value - `keychain.get` swallows not-found and
rethrows access errors WITHOUT the value, so no secret material reaches that
error object. Despite the premise being wrong, that one log was scrubbed to
message-only (`err instanceof Error ? err.message : String(err)`) defensively, so
no structured error payload can ever carry env material into logs. The "secrets
leak into logs" framing does not describe an actual code path.

### #4 - keychain delete failure not surfaced
ACCEPTED. Task 3, commit `c10abb6`. `deleteSecret` now captures the
`keychain.delete(...)` boolean, records `keychainDeleted: false` in the audit
detail when the credential could not be removed, and warns main-side - while
still removing the meta entry (the user wants it out of the list). A fake
keychain whose `delete` returns false asserts the audit detail.

### #5 - keychain get conflates not-found with access/locked errors
ACCEPTED. Task 3, commit `c10abb6`. `KeychainStore.get` now returns null only
for a genuine not-found and RETHROWS real access errors (e.g. locked keychain),
so `injectInto` can degrade to a secrets-less terminal AND distinguish "locked"
from "missing." NOTE: the not-found regex the plan suggested was WRONG - the real
@napi-rs/keyring message in this binary is "No matching credential found", not
the plan's guessed phrasing. The implementer corrected it empirically; the
shipped matcher is
`/\bno (matching |such )?(entry|credential|password|item)\b|not found/i`,
covering the real message plus older phrasings, with everything else rethrowing.

### #6 - audit chain throws on a corrupt line
ACCEPTED. Task 4, commit `5cb2a0d`. `readEntries` now tolerates an unparseable
line: `verifyAuditChain` treats a parse failure as an integrity failure
(returns false, does not throw), while `readAudit` skips unparseable lines for
best-effort display. A test corrupts line 1 to invalid JSON and asserts
`verifyAuditChain` returns false and `readAudit` does not throw.

### #7 - keychain set before meta write can orphan a value
ACCEPTED. Task 3, commit `c10abb6`. `setSecret` now writes meta FIRST, then the
keychain value. If the keychain set throws after the meta upsert, the entry is
visible in the list and inject reports it missing (the already-handled gentle
degrade) instead of an invisible keychain orphan. Tests assert end-state, not
ordering, and stay green.

### #8 - Finder-launched app inherits launchd's impoverished env (no PATH/locale)
ACCEPTED. Task 1, commit `f0e9a92`. The genuinely new, live-confirmed defect.
`captureLoginEnv()` / `loginShell()` (in `agent-core`, Electron-free) run the
user's login shell once at startup and capture its real PATH, LANG, etc.;
`main/index.ts` holds the result and passes it via an accessor into `pty:create`
as `baseEnv`. Terminals now get homebrew PATH and a working locale. Verified on
this machine: the login-env tests captured a non-empty PATH and HOME.

### #9 - spawned shell defaults / TERM_PROGRAM
ACCEPTED. Task 1, commit `f0e9a92`. Shell defaults to the passwd login shell
(not the empty `process.env.SHELL` under launchd), env merge is
`{ ...process.env, ...baseEnv, ...perCall }`, and `TERM_PROGRAM: "Airlock"` is
set into the merged env.

### #10 - no PTY backpressure / flow control
ACCEPTED. Task 2, commits `a030268` then `7ecceb3`. First attempt set
`handleFlowControl: true` in the session spawn options, but review found it INERT
without a consumer that actually writes XOFF/XON. The follow-up (`7ecceb3`) added
xterm write-callback high/low-water marks that send XOFF/XON via `ptyInput`, so
node-pty genuinely pauses the child under flood. See also #14.

### #11 - "call destroy() on the pty" (LETTER: WONTFIX; real intent addressed)
REFRAMED. Task 2, commit `a030268`. node-pty's `IPty` has NO `destroy()` method
- `kill()` IS the teardown (verified in the node-pty typings). Calling a
nonexistent method was not possible. The REAL intent - leaking the `onData` /
`onExit` IDisposables that `pty:create` was discarding - was addressed: those
subscriptions are now captured and `.dispose()`d in the `onExit` cleanup. The
literal "add a `destroy()` call" cannot be done and would be wrong.

### #12 - macOS window lifecycle (app quits when last window closes)
ACCEPTED. Task 5, commit `4ad78fd`. `window-all-closed` now guards with
`if (process.platform !== "darwin") app.quit();`, and an `activate` handler
recreates a window from the dock. The app is now stateful enough (terminals,
secrets, git) to warrant staying alive on macOS.

### #13 - no single-instance lock (two apps contend over .airlock/)
ACCEPTED. Task 5, commit `4ad78fd`. `app.requestSingleInstanceLock()` at setup;
on failure the second instance quits, and `second-instance` focuses the existing
window. Prevents two Airlocks fighting over the same project's `.airlock/` files.

### #14 - early terminal output dropped (subscribe-after-id race) + resize storm + reject zombie
ACCEPTED. Task 2, commits `a030268` then `7ecceb3`. First attempt's
"register-first" change only RELOCATED the drop: the callback filtered on an
id the renderer had not yet adopted, so pre-adopt bytes were still lost. The
re-fix (`7ecceb3`) buffers pre-adopt bytes and flushes them on id-adopt, fully
closing the practical window. Also in this task: the ResizeObserver callback is
trailing-debounced (~50ms) to kill the fit/resize storm on window drag, and a
failed `ptyCreate` now removes the terminal so a rejected spawn leaves no zombie
tab.

### #15 - "git show HEAD:path missing -- separator (argument injection)" (WONTFIX)
WONTFIX. No change. `git show HEAD:relPath` / `:0:relPath` uses git's rev:path
syntax, which is NOT a pathspec - `--` does not apply to it, and a leading-dash
filename becomes `HEAD:-foo`, which git reads as a path on that rev (harmless,
not parsed as a flag). Independently, `resolveWithin` already validates
containment before any git call is made, so a traversal or escape never reaches
the git invocation. There is no injection vector here as described.

### #16 - malformed project config silently swallowed
ACCEPTED. Task 4, commit `5cb2a0d`. `readProjectConfig` now distinguishes ENOENT
(return defaults silently - the normal first-run case) from a parse error
(return defaults BUT `console.warn` that the config file is malformed and was
ignored), so the user's typo is no longer hidden.

### #17 - dotenv double-quote unescaping incomplete (only \n, \")
ACCEPTED. Task 6, commit f07481a. The double-quote branch of `parseDotEnv` now
unescapes `\t`, `\r`, `\\` in addition to `\n` and `\"`, via a single-pass
regex (`val.replace(/\\(.)/g, ...)`) so escape ordering is correct: `\\n` (a
literal backslash followed by n) maps to backslash + n, NOT a newline, while
`\n` maps to a real newline. The single-quote branch stays fully literal. Tests
assert the `\t`/`\n` expansion, the `\\n` vs `\n` distinction, `\r`, and `\\`
collapsing to one backslash.

### #18 - "weak provider validators are a security risk" (SEVERITY: REFRAMED; light touch)
REFRAMED. Task 6, commit f07481a. The validators are ADVISORY ONLY: they classify
a secret's likely provider and surface a UI hint, and are NEVER on the write path
- `validateSecret` does not gate storage, so any value is vaulted regardless of
what the patterns match. A loose or wrong regex can only mislabel the displayed
provider HINT; it has roughly zero security impact and cannot block or alter
what is stored. The "weak validators = security hole" framing is wrong. Light
touch applied: a top-of-file ASCII comment stating the advisory-only contract
explicitly (the main deliverable), plus one minimal postgres-URL regex nudge
(require a real host token after `@`). All existing validator tests stay green.

### #19 - fs IPC handlers pass relPath without a typeof string guard
ACCEPTED. Task 6, commit f07481a. `fs:listDir` and `fs:readFile` were the only
handlers passing `relPath` to agent-core without a `typeof relPath === "string"`
guard (`resolveWithin` coerces and contains, but a clean early error is the
pattern every other handler uses). Both now
`throw new Error("Invalid payload")` on a non-string payload, matching the
sibling handlers. Verified the other fs/secrets/git/config handlers were already
guarded; only these two were missing.

### #20 - importDotEnv audit dishonest on partial failure
ACCEPTED. Task 4, commit `5cb2a0d` (with UI surfacing in `e8eee8b`). A mid-loop
`setSecret` failure previously aborted the loop and the `secret.import` summary
audit never wrote, even though earlier `secret.set` entries did. The per-item
set is now wrapped: failures push the name to a failed list and the loop
continues; the import summary always writes with accurate imported/skipped/failed
counts, and `deleteAfter` is gated on zero failures (not just zero skips). The
follow-up `e8eee8b` surfaces those failures in the Secrets status line. A test
covers a fake keychain that throws on the 2nd name: 1 imported, 1 failed, file
NOT deleted.

---

## Cross-cutting notes for the record

- #5 keychain regex: the plan's suggested not-found matcher was empirically
  WRONG. The real @napi-rs/keyring message here is "No matching credential
  found"; the implementer corrected the regex against the actual binary rather
  than shipping the plan's guess.
- #14 / #10 first attempt was INCOMPLETE and re-fixed in a follow-up: `a030268`
  only relocated the output-drop race (filtering on a not-yet-adopted id) and
  left `handleFlowControl` inert (no XOFF consumer). `7ecceb3` added the
  pre-adopt buffer + real XOFF/XON water-mark consumer, making both fixes
  actually effective.
- Residual (documented as acceptable, Task 2): a sub-millisecond window remains
  where main forwards before the renderer's IPC listener is attached; fully
  closing it would require a handshake protocol in `pty:create`. The
  register-first + pre-adopt buffer closes the practical window.
