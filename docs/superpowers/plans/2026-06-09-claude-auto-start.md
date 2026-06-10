# Auto-start Claude in Terminals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New project terminals automatically run `claude` per an app-global three-mode preference (`off` / `first` per tab / `every`, default `first`), configurable in Settings → Claude.

**Architecture:** The decision is one atomic store action (`claudeAutoDecision`) evaluated at pty-adoption time — `off` or blank tab → no; `every` → yes; `first` → claim the tab's `claudeAutoId` slot if free. `TerminalPane` is one line of wiring that writes `claude\n` into the pty (same write as the existing "Start Claude here" button). Pref plumbing mirrors `activeView` (shared type → main sanitize → `usePrefs` hydrate → store mirror).

**Tech Stack:** zustand store + vitest (node env for store/prefs tests), React Settings UI, no new IPC.

**Spec:** `docs/superpowers/specs/2026-06-09-claude-auto-start-design.md`

**Verification** (repo root): `npm test`, `npm run typecheck`, `npm run lint`. Targeted: `npx vitest run <repo-relative-path>` from the repo root. Commit after every task; never push.

---

## File structure

| File | Role |
| --- | --- |
| `packages/app/src/shared/ipc.ts` | `ClaudeAutoStart` type + `AppPrefs.claudeAutoStart`. |
| `packages/app/src/main/prefs.ts` | Default `"first"` + sanitize. |
| `packages/app/src/main/prefs.test.ts` | Defaults `toEqual`s + sanitize test. |
| `packages/app/src/renderer/src/store.ts` | `claudeAutoStart` mirror + setter; `TabTerminals.claudeAutoId`; `claudeAutoDecision`; `CLAUDE_AUTO_COMMAND`. |
| `packages/app/src/renderer/src/store.autoClaude.test.ts` | **New.** Decision/claim tests. |
| `packages/app/src/renderer/src/lib/usePrefs.ts` | Hydrate the new pref. |
| `packages/app/src/renderer/src/components/TerminalPane.tsx` | Adopt-time injection (one line, untested wiring per repo convention). |
| `packages/app/src/renderer/src/components/SettingsTab.tsx` | Mode `<select>` in the Claude section. |
| `packages/app/src/renderer/src/App.smoke.test.tsx` | `DEFAULT_PREFS` gains the field. |

---

### Task 1: Preference plumbing (`claudeAutoStart`)

**Files:**
- Modify: `packages/app/src/shared/ipc.ts` (AppPrefs, after the `quotaMeter` field)
- Modify: `packages/app/src/main/prefs.ts` (DEFAULTS + sanitize)
- Modify: `packages/app/src/main/prefs.test.ts`
- Modify: `packages/app/src/renderer/src/store.ts` (mirror + setter)
- Modify: `packages/app/src/renderer/src/lib/usePrefs.ts`
- Modify: `packages/app/src/renderer/src/App.smoke.test.tsx` (DEFAULT_PREFS)

- [ ] **Step 1.1: Failing tests** — in `packages/app/src/main/prefs.test.ts`:

(a) Every full-object `toEqual` block (there are FOUR: defaults-absent, persists-patch, sanitizes-garbage, malformed-JSON) contains the line `activeView: "files",`. Use a replace-all of

```ts
      activeView: "files",
```

with

```ts
      activeView: "files",
      claudeAutoStart: "first",
```

(b) After the `"sanitizes activeView to a known section"` test add:

```ts
  it("sanitizes claudeAutoStart to a known mode", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    const file = path.join(dir, "prefs.json");
    await writeFile(file, JSON.stringify({ claudeAutoStart: "sometimes" }));
    expect((await loadPrefs(file)).claudeAutoStart).toBe("first");
    await savePrefs(file, { claudeAutoStart: "off" });
    expect((await loadPrefs(file)).claudeAutoStart).toBe("off");
    await savePrefs(file, { claudeAutoStart: "every" });
    expect((await loadPrefs(file)).claudeAutoStart).toBe("every");
  });
```

- [ ] **Step 1.2: Run — expect failure**

Run: `npx vitest run packages/app/src/main/prefs.test.ts`
Expected: FAIL — the four `toEqual`s miss `claudeAutoStart` and the new test gets no field.

- [ ] **Step 1.3: Implement**

`packages/app/src/shared/ipc.ts` — directly after the `quotaMeter: { enabled: boolean };` line inside `AppPrefs` add (and export the type near `Section`/`SectionVisibility`):

```ts
  // Auto-run `claude` in newly created PROJECT terminals. "first" = only when
  // no other terminal in the tab holds the auto-Claude claim; blank tabs are
  // always exempt. App-global.
  claudeAutoStart: ClaudeAutoStart;
```

and above `AppPrefs`:

```ts
export type ClaudeAutoStart = "off" | "first" | "every";
```

`packages/app/src/main/prefs.ts`:

(a) Import the type: add `ClaudeAutoStart` to the existing `import type { ... } from "../shared/ipc"`.

(b) Under `quotaMeter: { enabled: true },` in `DEFAULTS`:

```ts
  claudeAutoStart: "first",
```

(c) Above `sanitize()`:

```ts
const CLAUDE_AUTO_MODES: ClaudeAutoStart[] = ["off", "first", "every"];
```

(d) In `sanitize()`, under the `quotaMeter: sanitizeQuotaMeter(r.quotaMeter),` line:

```ts
    claudeAutoStart: CLAUDE_AUTO_MODES.includes(
      r.claudeAutoStart as ClaudeAutoStart,
    )
      ? (r.claudeAutoStart as ClaudeAutoStart)
      : "first",
```

`packages/app/src/renderer/src/store.ts`:

(a) Add `ClaudeAutoStart` to the shared-ipc type import.

(b) In `AppState` under `activeView: Section; ...`:

```ts
  claudeAutoStart: ClaudeAutoStart; // app-global (persisted): auto-run claude in new project terminals
```

(c) In the app-global setters block under `setActiveView`:

```ts
  setClaudeAutoStart: (v: ClaudeAutoStart) => void;
```

(d) Initial state under `activeView: "files",`:

```ts
  claudeAutoStart: "first",
```

(e) Impl under `setActiveView: (activeView) => set({ activeView }),`:

```ts
  setClaudeAutoStart: (claudeAutoStart) => set({ claudeAutoStart }),
```

`packages/app/src/renderer/src/lib/usePrefs.ts` — three additions mirroring `setActiveView`: selector `const setClaudeAutoStart = useApp((s) => s.setClaudeAutoStart);`, hydrate line `setClaudeAutoStart(p.claudeAutoStart);` right after `setActiveView(p.activeView);`, and `setClaudeAutoStart` in the dependency array.

`packages/app/src/renderer/src/App.smoke.test.tsx` — in `DEFAULT_PREFS` under `activeView: "files",`:

```ts
  claudeAutoStart: "off",
```

(any value type-checks; "off" documents that smoke terminals must stay plain).

- [ ] **Step 1.4: Run — expect pass**

Run: `npx vitest run packages/app/src/main/prefs.test.ts packages/app/src/renderer/src/App.smoke.test.tsx && npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 1.5: Commit**

```bash
git add packages/app/src/shared/ipc.ts packages/app/src/main/prefs.ts packages/app/src/main/prefs.test.ts packages/app/src/renderer/src/store.ts packages/app/src/renderer/src/lib/usePrefs.ts packages/app/src/renderer/src/App.smoke.test.tsx
git commit -m "feat(prefs): claudeAutoStart mode (off/first/every, default first)"
```

---

### Task 2: Store claim model + decision action

**Files:**
- Modify: `packages/app/src/renderer/src/store.ts`
- Create: `packages/app/src/renderer/src/store.autoClaude.test.ts`

- [ ] **Step 2.1: Failing tests** — create `packages/app/src/renderer/src/store.autoClaude.test.ts`:

```ts
import { afterEach, beforeEach, expect, it } from "vitest";
import { CLAUDE_AUTO_COMMAND, useApp } from "./store";

const initialState = useApp.getState();
beforeEach(() => useApp.setState(initialState, true));
afterEach(() => useApp.setState(initialState, true));

// The launch tab is BLANK (root null). Give it a project root via openProject
// (which creates a NEW tab with fresh tabTerminals) so decisions apply.
const openProjectTab = (root: string): string => {
  useApp.getState().openProject(root);
  return useApp.getState().activeTabId;
};

it("exports the exact command the Start-Claude-here button uses", () => {
  expect(CLAUDE_AUTO_COMMAND).toBe("claude\n");
});

it("off mode never grants", () => {
  useApp.getState().setClaudeAutoStart("off");
  const tab = openProjectTab("/tmp/projA");
  const id = useApp.getState().addTerminal(tab);
  expect(useApp.getState().claudeAutoDecision(id)).toBe(false);
});

it("blank tabs never grant, regardless of mode", () => {
  useApp.getState().setClaudeAutoStart("every");
  const blankTab = useApp.getState().activeTabId; // initial tab, root null
  const id = useApp.getState().addTerminal(blankTab);
  expect(useApp.getState().claudeAutoDecision(id)).toBe(false);
});

it("every mode grants every project terminal", () => {
  useApp.getState().setClaudeAutoStart("every");
  const tab = openProjectTab("/tmp/projA");
  const a = useApp.getState().addTerminal(tab);
  const b = useApp.getState().addTerminal(tab);
  expect(useApp.getState().claudeAutoDecision(a)).toBe(true);
  expect(useApp.getState().claudeAutoDecision(b)).toBe(true);
});

it("first mode grants once per tab and is idempotent for the holder", () => {
  useApp.getState().setClaudeAutoStart("first");
  const tab = openProjectTab("/tmp/projA");
  const a = useApp.getState().addTerminal(tab);
  const b = useApp.getState().addTerminal(tab);
  expect(useApp.getState().claudeAutoDecision(a)).toBe(true);
  expect(useApp.getState().claudeAutoDecision(b)).toBe(false); // claim held by a
  expect(useApp.getState().claudeAutoDecision(a)).toBe(true); // re-ask: still ours
});

it("first mode re-grants after the holder is removed", () => {
  useApp.getState().setClaudeAutoStart("first");
  const tab = openProjectTab("/tmp/projA");
  const a = useApp.getState().addTerminal(tab);
  expect(useApp.getState().claudeAutoDecision(a)).toBe(true);
  useApp.getState().removeTerminal(a);
  const b = useApp.getState().addTerminal(tab);
  expect(useApp.getState().claudeAutoDecision(b)).toBe(true);
});

it("claims are independent per tab", () => {
  useApp.getState().setClaudeAutoStart("first");
  const tabA = openProjectTab("/tmp/projA");
  const a = useApp.getState().addTerminal(tabA);
  const tabB = openProjectTab("/tmp/projB");
  const b = useApp.getState().addTerminal(tabB);
  expect(useApp.getState().claudeAutoDecision(a)).toBe(true);
  expect(useApp.getState().claudeAutoDecision(b)).toBe(true);
});

it("unknown terminal ids never grant", () => {
  useApp.getState().setClaudeAutoStart("every");
  expect(useApp.getState().claudeAutoDecision("term-nope")).toBe(false);
});
```

- [ ] **Step 2.2: Run — expect failure**

Run: `npx vitest run packages/app/src/renderer/src/store.autoClaude.test.ts`
Expected: FAIL — `CLAUDE_AUTO_COMMAND` / `claudeAutoDecision` don't exist.

- [ ] **Step 2.3: Implement** in `packages/app/src/renderer/src/store.ts`:

(a) `TabTerminals` interface gains a field (after `splitTerminalId`):

```ts
  // Terminal currently holding this tab's auto-Claude claim ("first" mode):
  // set by claudeAutoDecision at pty adoption, released when that terminal is
  // removed. null = free.
  claudeAutoId: string | null;
```

(b) Both factory literals gain `claudeAutoId: null`: in `emptyTabTerminals()` and in the `EMPTY_TAB_TERMINALS` const (each currently `{ terminals: [], activeTerminalId: null, splitTerminalId: null }`).

(c) `removeFromTab` releases the claim — change its final return from

```ts
  return { terminals, splitTerminalId, activeTerminalId };
```

to

```ts
  return {
    terminals,
    splitTerminalId,
    activeTerminalId,
    // The auto-Claude claim dies with its holder so the tab's next new
    // terminal can claim it again ("first" mode regains a session).
    claudeAutoId: tt.claudeAutoId === id ? null : tt.claudeAutoId,
  };
```

(d) Export the command const near the top (after `EMPTY_TAB_TERMINALS`):

```ts
// The exact bytes the "Start Claude here" notice writes: run claude INSIDE the
// shell so exiting it returns to the prompt.
export const CLAUDE_AUTO_COMMAND = "claude\n";
```

(e) Declare the action in `AppState` (terminal setters block, after `setSplit`):

```ts
  // Should the terminal that just adopted its pty auto-run claude? Atomic:
  // in "first" mode a true return ALSO takes the tab's claim. False for
  // blank tabs, unknown ids, and mode "off".
  claudeAutoDecision: (terminalId: string) => boolean;
```

(f) Implement it in the store object (after the `setSplit` implementation). It needs the owning tab — the same `findOwningTabId(s.tabTerminals, id)` helper `removeTerminal` uses:

```ts
  claudeAutoDecision: (terminalId) => {
    let granted = false;
    set((s) => {
      const mode = s.claudeAutoStart;
      if (mode === "off") return {};
      const tabId = findOwningTabId(s.tabTerminals, terminalId);
      if (tabId === null) return {};
      if ((s.tabState[tabId]?.root ?? null) === null) return {}; // blank tab
      if (mode === "every") {
        granted = true;
        return {};
      }
      const tt = s.tabTerminals[tabId];
      if (!tt) return {};
      if (tt.claudeAutoId !== null && tt.claudeAutoId !== terminalId)
        return {}; // another terminal already holds the claim
      granted = true;
      if (tt.claudeAutoId === terminalId) return {}; // already ours
      return {
        tabTerminals: {
          ...s.tabTerminals,
          [tabId]: { ...tt, claudeAutoId: terminalId },
        },
      };
    });
    return granted;
  },
```

- [ ] **Step 2.4: Run — expect pass (plus no regressions)**

Run: `npx vitest run packages/app/src/renderer/src/store.autoClaude.test.ts packages/app/src/renderer/src/store.test.ts packages/app/src/renderer/src/App.smoke.test.tsx`
Expected: PASS (the factory-literal change is type-driven; any store test building `TabTerminals` literals will fail typecheck until updated — fix by adding `claudeAutoId: null` there too).

- [ ] **Step 2.5: Commit**

```bash
git add packages/app/src/renderer/src/store.ts packages/app/src/renderer/src/store.autoClaude.test.ts
git commit -m "feat(store): per-tab auto-Claude claim + atomic claudeAutoDecision"
```

---

### Task 3: Wiring (TerminalPane) + Settings UI

**Files:**
- Modify: `packages/app/src/renderer/src/components/TerminalPane.tsx` (adopt callback)
- Modify: `packages/app/src/renderer/src/components/SettingsTab.tsx` (Claude section)

- [ ] **Step 3.1: TerminalPane injection** — in the `ptyCreate(...).then((id) => { ... })` adopt callback, directly after `setTerminalPty(terminalId, id);` add:

```ts
        // Auto-start claude when the store grants it (mode/blank-tab/claim
        // logic lives there). Typed-ahead bytes sit in the pty buffer until
        // zsh reads them, so shell startup timing cannot drop the command.
        if (useApp.getState().claudeAutoDecision(terminalId)) {
          window.airlock.ptyInput(id, CLAUDE_AUTO_COMMAND);
        }
```

and extend the store import at the top of the file:

```ts
import { CLAUDE_AUTO_COMMAND, useApp } from "../store";
```

- [ ] **Step 3.2: Settings UI** — in `packages/app/src/renderer/src/components/SettingsTab.tsx`:

(a) Add selectors next to `quotaMeterEnabled`:

```ts
  const claudeAutoStart = useApp((s) => s.claudeAutoStart);
  const setClaudeAutoStart = useApp((s) => s.setClaudeAutoStart);
```

(b) Add the import type at the top: `import type { ClaudeAutoStart } from "../../../shared/ipc";` (merge into an existing shared-ipc type import if one exists).

(c) Inside the `<section>` with `<h3>Claude</h3>`, after the quota meter's `</p>` note, add:

```tsx
          <div className="settings-row">
            <label htmlFor="claude-auto-start">
              Auto-start Claude in terminals
            </label>
            <select
              id="claude-auto-start"
              value={claudeAutoStart}
              onChange={(e) => {
                const v = e.target.value as ClaudeAutoStart;
                useApp.getState().setLayoutHydrated(true);
                setClaudeAutoStart(v);
                void window.airlock.prefsSet({ claudeAutoStart: v });
              }}
            >
              <option value="first">First terminal per tab</option>
              <option value="every">Every terminal</option>
              <option value="off">Off</option>
            </select>
          </div>
          <p className="settings-note">
            Runs `claude` automatically in new terminals of project tabs.
            "First terminal per tab" starts one session per project; extra
            terminals open as plain shells. Blank tabs are never auto-started.
          </p>
```

- [ ] **Step 3.3: Full gates**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green (fix anything biome reformats with `npx biome check --write .`).

- [ ] **Step 3.4: Commit**

```bash
git add packages/app/src/renderer/src/components/TerminalPane.tsx packages/app/src/renderer/src/components/SettingsTab.tsx
git commit -m "feat(terminal): auto-start claude per claudeAutoStart pref + Settings control"
```

---

### Task 4: Docs + finish

- [ ] **Step 4.1:** Spec status line gains `Implemented on feat/auto-claude.`
- [ ] **Step 4.2:** Add a short "Claude auto-start" bullet to the project `CLAUDE.md` near the quota meter section: pref name, modes, default, the per-tab claim, blank-tab exemption, and that `TerminalPane` injects `CLAUDE_AUTO_COMMAND` at pty adoption.
- [ ] **Step 4.3:** `npm test && npm run typecheck && npm run lint` — all green.
- [ ] **Step 4.4:** Commit docs; then finishing-a-development-branch (merge choice is the owner's).

```bash
git add CLAUDE.md docs/
git commit -m "docs: claude auto-start notes (spec status, CLAUDE.md)"
```

---

## Self-review notes

- **Spec coverage:** modes/default (T1), per-tab claim + release-on-kill (T2), blank-tab exemption + adoption-time decision (T2/T3), exact `claude\n` write (T2 const, T3 wiring), Settings UI (T3), sanitize/error handling (T1), docs (T4). The `openPickedFolder` flow needs no code: the scratch shell never claims (blank tab), so the folder-rooted terminal's adoption claims normally — covered by the per-tab tests.
- **Type consistency:** `ClaudeAutoStart` (shared), `claudeAutoStart` (pref + store), `claudeAutoId` (TabTerminals), `claudeAutoDecision(terminalId): boolean`, `CLAUDE_AUTO_COMMAND` — names match across tasks.
- **Convention check:** TerminalPane wiring stays untested (CLAUDE.md: thin electron wiring untested); all logic is in the unit-tested store action.
