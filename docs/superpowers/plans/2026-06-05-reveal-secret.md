# Reveal Secret Value Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Owner-only reveal + auto-clearing copy of vaulted secret values in the Secrets sidebar, with a configurable clipboard-clear delay in Settings -- and zero new agent value path.

**Architecture:** Two new RENDERER-ONLY IPCs in `main/ipc.ts` (NOT in `mcp/tools.ts`): `secrets:reveal(name)` returns the value to the renderer for inline display; `clipboard:copySecret(name)` resolves the value main-side, writes it to the clipboard, and conditionally auto-clears it -- the value never enters the renderer for a copy. A new app-global `clipboardClearSeconds` pref (default 30) drives the clear delay, configurable in the SettingsTab "Secrets" section with a risk explanation. Both ops are audited (name only). `mcp/tools.ts` is untouched, so the 11-tool allowlist + the `getSecretValue` source-guard stay green.

**Tech Stack:** Electron (`clipboard` module, main), TypeScript (strict, noUncheckedIndexedAccess), React 19, Zustand, vitest, biome.

**Spec:** `docs/superpowers/specs/2026-06-05-reveal-secret-design.md`

**Constraints:**
- ASCII-only comments AND string literals in `packages/app/src/main/**`, `packages/app/src/shared/ipc.ts`, `packages/app/src/preload/index.ts`, `packages/agent-core/**` (CJS-bundled; cjs_lexer crashes on multibyte). Renderer (`.tsx`/`.css`/`store.ts`/`usePrefs.ts`) is EXEMPT.
- Do NOT touch `packages/app/src/main/mcp/tools.ts` (keeps the source-guard + 11-allowlist green; the agent keeps zero value path).
- `getSecretValue(root, name): Promise<string | null>` already exists + is imported in `ipc.ts`. `appendAudit`, `loadPrefs`, `requireRoot`, `prefsFile` are all already in scope in `ipc.ts`.

---

## Task 1: main IPC + prefs + preload/shared (the value layer)

**Files:**
- Modify: `packages/app/src/main/ipc.ts` (import `clipboard`; add `secrets:reveal` + `clipboard:copySecret`)
- Modify: `packages/app/src/shared/ipc.ts` (`AppPrefs.clipboardClearSeconds`; `AirlockApi.secretsReveal` + `clipboardCopySecret`)
- Modify: `packages/app/src/main/prefs.ts` (DEFAULT + sanitize clamp)
- Modify: `packages/app/src/preload/index.ts` (`secretsReveal`, `clipboardCopySecret`)
- Modify: `packages/agent-core/src/broker/broker.ts` (banner: document the owner-only exception)
- Test: `packages/app/src/main/prefs.test.ts` (clamp)

- [ ] **Step 1: Add the pref to AppPrefs + the two API methods (shared/ipc.ts)**

In `packages/app/src/shared/ipc.ts`, add `clipboardClearSeconds` to `AppPrefs` (after `sectionVisibility`):
```ts
  clipboardClearSeconds: number; // app-global; 0 = never auto-clear the clipboard
```
And to `AirlockApi`, in the `secrets*` block:
```ts
  secretsReveal(name: string): Promise<string | null>;
```
And a new clipboard method (near the secrets block):
```ts
  clipboardCopySecret(
    name: string,
  ): Promise<{ copied: boolean; clearAfterSeconds: number }>;
```

- [ ] **Step 2: Default + clamp in prefs.ts**

In `packages/app/src/main/prefs.ts`, add to `DEFAULTS`:
```ts
  clipboardClearSeconds: 30,
```
And in `sanitize`, add the clamped field to the returned object (mirror the boolean checks; clamp [0,3600], floor, non-finite -> default):
```ts
    clipboardClearSeconds:
      typeof r.clipboardClearSeconds === "number" &&
      Number.isFinite(r.clipboardClearSeconds)
        ? Math.min(3600, Math.max(0, Math.floor(r.clipboardClearSeconds)))
        : DEFAULTS.clipboardClearSeconds,
```

- [ ] **Step 3: Failing test for the clamp**

In `packages/app/src/main/prefs.test.ts`, add (match the file's existing import of `sanitize`/`loadPrefs` -- if `sanitize` is not exported, test via `savePrefs`/`loadPrefs` round-trip instead; check the file's existing pattern first):
```ts
describe("clipboardClearSeconds", () => {
  it("defaults to 30 when absent or wrong type", () => {
    expect(sanitize({}).clipboardClearSeconds).toBe(30);
    expect(sanitize({ clipboardClearSeconds: "x" }).clipboardClearSeconds).toBe(30);
  });
  it("clamps to [0, 3600] and floors", () => {
    expect(sanitize({ clipboardClearSeconds: -5 }).clipboardClearSeconds).toBe(0);
    expect(sanitize({ clipboardClearSeconds: 99999 }).clipboardClearSeconds).toBe(3600);
    expect(sanitize({ clipboardClearSeconds: 45.7 }).clipboardClearSeconds).toBe(45);
  });
});
```
Run: `cd /Users/ricardoramos/Projects/airlock && npx vitest run packages/app/src/main/prefs.test.ts` -> should PASS once Step 2 is in (it tests Step 2). If `sanitize` is private, adapt to the file's accessor (e.g. `loadPrefs` after writing a fixture) and keep the same assertions.

- [ ] **Step 4: The two handlers (ipc.ts)**

In `packages/app/src/main/ipc.ts`: extend the electron import (currently `import { dialog, ipcMain, shell } from "electron";`):
```ts
import { clipboard, dialog, ipcMain, shell } from "electron";
```
Add both handlers next to the other `secrets:*` handlers:
```ts
  // OWNER-ONLY value path. The renderer is the human's surface; the agent (a
  // separate process, reachable only over MCP) cannot call this IPC and is NOT
  // given any value tool. Audited (name only). See broker.getSecretValue banner.
  ipcMain.handle("secrets:reveal", async (_e, name: unknown) => {
    if (typeof name !== "string") throw new Error("Invalid payload");
    const root = requireRoot();
    await appendAudit(root, "user", "secret.reveal", { name });
    return getSecretValue(root, name);
  });

  // Copy by NAME so the value never enters the renderer: main resolves it, puts
  // it on the clipboard, and conditionally auto-clears after the configured delay
  // (0 = never; clears only if the clipboard still holds this exact value).
  ipcMain.handle("clipboard:copySecret", async (_e, name: unknown) => {
    if (typeof name !== "string") throw new Error("Invalid payload");
    const root = requireRoot();
    const value = await getSecretValue(root, name);
    if (value === null) return { copied: false, clearAfterSeconds: 0 };
    clipboard.writeText(value);
    await appendAudit(root, "user", "secret.copy", { name });
    const seconds = loadPrefs(prefsFile).clipboardClearSeconds;
    if (seconds > 0) {
      setTimeout(() => {
        if (clipboard.readText() === value) clipboard.writeText("");
      }, seconds * 1000);
    }
    return { copied: true, clearAfterSeconds: seconds };
  });
```
(Confirm `requireRoot`, `appendAudit`, `getSecretValue`, `loadPrefs`, `prefsFile` are already in scope -- per the integration map they are. If `prefsFile` is a `registerIpc` param, it is in the closure.)

- [ ] **Step 5: preload bridge (preload/index.ts)**

Add to the `secrets*` block:
```ts
  secretsReveal: (name) => ipcRenderer.invoke("secrets:reveal", name),
  clipboardCopySecret: (name) => ipcRenderer.invoke("clipboard:copySecret", name),
```

- [ ] **Step 6: Update the broker MAIN-ONLY banner (broker.ts)**

In `packages/agent-core/src/broker/broker.ts`, the banner currently says `* NEVER return its result over renderer IPC.` Replace that single bullet with (ASCII only):
```ts
//   * NEVER register this as an agent/MCP tool.
//   * The ONLY renderer IPC that may return this is the explicit, OWNER-triggered
//     secrets:reveal / clipboard:copySecret in app main/ipc.ts (audited, name
//     only; the agent process cannot reach renderer IPC). Do NOT add others.
```
Keep the rest of the banner intact. (This is a comment-only change; ASCII.)

- [ ] **Step 7: Verify + commit**

Run: `cd /Users/ricardoramos/Projects/airlock && npm run typecheck && npm test && npm run lint`
Expected: typecheck clean (adding `clipboardClearSeconds` to `AppPrefs` will force the store/usePrefs in Task 2 -- but Task 1 alone must still typecheck; if `AppPrefs` is constructed anywhere exhaustively it may error until Task 2. If so, that is expected and Task 2 closes it -- but prefer: the only exhaustive `AppPrefs` literal is `DEFAULTS`, which Step 2 covers, so Task 1 should typecheck alone). All tests pass; lint clean.
```bash
git add packages/app/src/main/ipc.ts packages/app/src/shared/ipc.ts packages/app/src/main/prefs.ts packages/app/src/main/prefs.test.ts packages/app/src/preload/index.ts packages/agent-core/src/broker/broker.ts
git commit -m "feat(secrets): owner-only secrets:reveal + clipboard:copySecret IPC + clipboardClearSeconds pref"
```

---

## Task 2: renderer -- reveal/copy UI + the Settings control

**Files:**
- Modify: `packages/app/src/renderer/src/store.ts` (`clipboardClearSeconds` field + setter)
- Modify: `packages/app/src/renderer/src/lib/usePrefs.ts` (hydrate it)
- Modify: `packages/app/src/renderer/src/components/SettingsTab.tsx` (the clipboard-delay control + risk copy)
- Modify: `packages/app/src/renderer/src/components/SecretsSection.tsx` (eye + copy per row)
- Modify: `packages/app/src/renderer/src/theme.css` (hover-reveal styles)

- [ ] **Step 1: store field + setter (store.ts)**

Add a `clipboardClearSeconds: number;` field (next to `theme`), `setClipboardClearSeconds: (n: number) => void;` to the setter types, `clipboardClearSeconds: 30,` to the initial state, and `setClipboardClearSeconds: (clipboardClearSeconds) => set({ clipboardClearSeconds }),` to the impl. Mirror the existing `theme` lines exactly.

- [ ] **Step 2: hydrate (usePrefs.ts)**

In `packages/app/src/renderer/src/lib/usePrefs.ts`: pull `setClipboardClearSeconds` from the store (the selector block at the top), call `setClipboardClearSeconds(p.clipboardClearSeconds)` inside the guarded `.then` (next to `setTheme(p.theme)`), and add `setClipboardClearSeconds` to the effect dep array. Mirror `setTheme`.

- [ ] **Step 3: the Settings control + risk copy (SettingsTab.tsx)**

In the "Secrets" `<section>`, OUTSIDE the `root ?` ternary (it is app-global), add a clipboard-clear control. Read `const clipboardClearSeconds = useApp((s) => s.clipboardClearSeconds);` and a setter `const setClipboardClearSeconds = useApp((s) => s.setClipboardClearSeconds);`. Add:
```tsx
<div className="settings-row">
  <label htmlFor="clip-clear">Clipboard auto-clear (seconds, 0 = never)</label>
  <input
    id="clip-clear"
    type="number"
    min={0}
    max={3600}
    value={clipboardClearSeconds}
    onChange={(e) => {
      const n = Math.min(3600, Math.max(0, Math.floor(Number(e.target.value) || 0)));
      useApp.getState().setLayoutHydrated(true);
      setClipboardClearSeconds(n);
      void window.airlock.prefsSet({ clipboardClearSeconds: n });
    }}
  />
</div>
<p className="settings-note">
  When you copy a secret, it goes to the system clipboard, which other apps — and
  the terminal agent via <code>pbpaste</code> — can read while it is there. airlock
  clears it after this delay (clearing only if the clipboard still holds that
  secret). A longer delay, or <strong>0 (never)</strong>, is more convenient but
  leaves the value readable for longer. airlock cannot purge a third-party
  clipboard manager's history.
</p>
```
(Match the file's existing `.settings-row` / `.settings-note` usage. Renderer is unicode-exempt, so the em-dash and `<code>`/`<strong>` are fine.)

- [ ] **Step 4: eye + copy per row (SecretsSection.tsx)**

Add local state at the top of the component:
```tsx
const [revealed, setRevealed] = useState<Record<string, string>>({});
const [copied, setCopied] = useState<string | null>(null);
```
A reveal toggle handler:
```tsx
const toggleReveal = async (name: string) => {
  if (revealed[name] !== undefined) {
    setRevealed((r) => {
      const next = { ...r };
      delete next[name];
      return next;
    });
    return;
  }
  const value = await window.airlock.secretsReveal(name);
  setRevealed((r) => ({ ...r, [name]: value ?? "(not found)" }));
};
```
A copy handler:
```tsx
const copyValue = async (name: string) => {
  const res = await window.airlock.clipboardCopySecret(name);
  if (res.copied) {
    setCopied(name);
    const ms = res.clearAfterSeconds > 0 ? 2500 : 2500;
    setTimeout(() => setCopied((c) => (c === name ? null : c)), ms);
  }
};
```
In the row (after `.secret-delete`, or grouped before it), add the eye + copy buttons with the hover-reveal class, and an inline reveal area below the row:
```tsx
<button
  type="button"
  className="secret-action"
  title={revealed[s.name] !== undefined ? "Hide value" : "Reveal value"}
  onClick={() => void toggleReveal(s.name)}
>
  <i className={`codicon codicon-${revealed[s.name] !== undefined ? "eye-closed" : "eye"}`} />
</button>
<button
  type="button"
  className="secret-action"
  title="Copy value to clipboard"
  onClick={() => void copyValue(s.name)}
>
  <i className="codicon codicon-copy" />
</button>
```
And, after the `.secret-row` closing tag (still inside the `.map`, wrap the row + reveal in a fragment keyed by `s.name`), render the reveal + copied hint:
```tsx
{revealed[s.name] !== undefined && (
  <div className="secret-reveal">{revealed[s.name]}</div>
)}
{copied === s.name && (
  <div className="secret-copied">
    Copied — clears from clipboard
    {clipboardClearSeconds > 0 ? ` in ${clipboardClearSeconds}s` : " disabled (set in Settings)"}
  </div>
)}
```
Read `const clipboardClearSeconds = useApp((s) => s.clipboardClearSeconds);` in the component for the hint. Clear `revealed`/`copied` when the list refreshes (in `refresh`, after `setSecrets`, also `setRevealed({})`). Keep the `key={s.name}` on the outer fragment/wrapper.

- [ ] **Step 5: hover-reveal CSS (theme.css)**

Add `.secret-action` to the hidden-until-hover rule + the hover trigger group, and style the reveal/copied areas:
```css
.secret-action {
  background: none;
  border: none;
  color: var(--fg-dim);
  cursor: pointer;
  font-size: 11px;
  opacity: 0;
  transition: opacity 80ms linear;
}
.secret-action:hover { color: var(--accent); }
```
Add `.secret-action` to the existing reveal-on-hover selector group (the one listing `.secret-row:hover .secret-delete, .secret-row:focus-within .secret-delete, ...`):
```css
.secret-row:hover .secret-action,
.secret-row:focus-within .secret-action { opacity: 1; }
```
And the reveal/hint blocks:
```css
.secret-reveal {
  font-family: "SF Mono", Menlo, monospace;
  font-size: 11px;
  color: var(--fg);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 6px;
  margin: 0 0 4px 22px;
  user-select: all;
  word-break: break-all;
}
.secret-copied {
  font-size: 10px;
  color: var(--fg-dim);
  margin: 0 0 4px 22px;
}
```

- [ ] **Step 6: Verify + commit**

Run: `cd /Users/ricardoramos/Projects/airlock && npm run typecheck && npm test && npm run lint`
Expected: all green. (Fix any biome formatting it requests in the touched files.)
```bash
git add packages/app/src/renderer/src/store.ts packages/app/src/renderer/src/lib/usePrefs.ts packages/app/src/renderer/src/components/SettingsTab.tsx packages/app/src/renderer/src/components/SecretsSection.tsx packages/app/src/renderer/src/theme.css
git commit -m "feat(secrets): reveal (eye) + copy buttons per secret row, with Settings clipboard-clear control"
```

---

## Task 3: docs + verify + repackage

**Files:**
- Modify: `docs/superpowers/specs/2026-06-05-reveal-secret-design.md` (status -> v1 complete)
- Modify: `packages/app/resources/mcp-docs/security-model.md` (document the owner-only reveal/copy path)
- Modify: `packages/app/resources/mcp-docs/sidebar-secrets.md` (the eye/copy + clipboard-clear setting)
- Modify: `README.md` (if it lists features)

- [ ] **Step 1: security-model.md** -- add a short section: the OWNER can reveal/copy a secret in the UI (`secrets:reveal` / `clipboard:copySecret`, renderer-only, audited `secret.reveal`/`secret.copy`); this is NOT an agent/MCP tool and does not change the agent's zero-value invariant (allowlist still 11, source-guard green); copy auto-clears the clipboard after a configurable delay (default 30s); honest caveat: the owner can paste a value into the agent themselves, and the clipboard is a shared OS surface during the clear window.

- [ ] **Step 2: sidebar-secrets.md** -- note the per-row eye (reveal value) + copy (auto-clearing) actions, and that the clipboard-clear delay is set in Settings -> Secrets (default 30s, 0 = never), with the clipboard risk.

- [ ] **Step 3: README** -- if there is a secrets/feature list, add a one-line "reveal/copy your own secret values (the agent still can't)". Skip if no such list.

- [ ] **Step 4: spec status** -> `**Status:** v1 complete.`

- [ ] **Step 5: Full verification**
Run: `cd /Users/ricardoramos/Projects/airlock && npm run typecheck && npm test && npm run lint && npm run build`
All green; record the test count.

- [ ] **Step 6: Repackage**
Run: `cd /Users/ricardoramos/Projects/airlock && npm run package`
Confirm a fresh `.app` builds; note the timestamp.

- [ ] **Step 7: Commit**
```bash
git add docs/superpowers/specs/2026-06-05-reveal-secret-design.md packages/app/resources/mcp-docs/ README.md
git commit -m "docs(secrets): document owner-only reveal/copy; verify + repackage"
```

---

## Self-review notes
- No agent value path added: `tools.ts` untouched -> allowlist 11 + source-guard green by construction. The new IPCs are renderer-only.
- Audited name-only (`secret.reveal` / `secret.copy`); never the value.
- Copy keeps the value out of the renderer (by-name main op); reveal is the only renderer value path, cleared on refresh/toggle.
- Clipboard clear is conditional (won't clobber a later copy) + configurable (0 = never) + risk-explained in Settings.
- ASCII in main/shared/preload/agent-core; renderer exempt.
