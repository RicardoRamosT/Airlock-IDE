# Airlock Terminal Tabs Implementation Plan (VS Code terminal management)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VS Code-grade terminal management: multiple terminals with a tab strip (icon · title · close), `+` new, kill, **split** (two side-by-side), **maximize** (terminal swallows sidebar + viewer), double-click rename, and process-aware titles via the shell's OSC title updates. Closes the long-standing orphan-PTY TODO with a real `pty:kill` channel.

**Owner direction (2026-06-03):** screenshot of VS Code's terminal panel header — "Add this type of features into my terminal."

**Architecture:** One new IPC channel (`pty:kill`). All terminal instances stay MOUNTED and CSS-hidden when inactive (an unmount kills the shell — buffers must survive tab switches). The store owns the terminal list; each TerminalPane owns its PTY lifecycle and reports `ptyId`/titles/exit upward. Tab close = unmount = `pty:kill` (the orphan wart dies). `termNonce` is retired; the secrets restart-hint restarts only the ACTIVE terminal.

---

## File structure

```text
packages/app/src/
  shared/ipc.ts          # MODIFIED: ptyKill
  main/ipc.ts            # MODIFIED: pty:kill handler
  preload/index.ts       # MODIFIED: ptyKill wiring
  renderer/src/
    store.ts             # MODIFIED: terminals model (replaces termNonce)
    App.tsx              # MODIFIED: TerminalManager replaces single pane; maximize class
    theme.css            # MODIFIED: tab strip, split grid, maximize rules
    components/
      TerminalPane.tsx   # MODIFIED: props (terminal id, active), title/exit reporting, unmount-kill
      TerminalTabs.tsx   # NEW: tab strip + actions
      TerminalManager.tsx# NEW: renders tabs + all panes (hidden/active/split)
      SecretsSection.tsx # MODIFIED: restart hint restarts active terminal
```

---

### Task 1: `pty:kill` channel + store terminal model

**Files:**
- Modify: `packages/app/src/shared/ipc.ts`
- Modify: `packages/app/src/main/ipc.ts`
- Modify: `packages/app/src/preload/index.ts`
- Modify: `packages/app/src/renderer/src/store.ts`

- [ ] **Step 1: shared/ipc.ts** — add to AirlockApi:

```ts
  ptyKill(id: string): void;
```

- [ ] **Step 2: main/ipc.ts** — alongside the other `ipcMain.on` pty handlers:

```ts
  ipcMain.on("pty:kill", (_e, id: unknown) => {
    if (typeof id !== "string") return;
    sessions.get(id)?.kill();
    // onExit cleanup (sessions.delete + pty:exit notify) already wired in pty:create.
  });
```

- [ ] **Step 3: preload/index.ts** — `ptyKill: (id) => ipcRenderer.send("pty:kill", id),`

- [ ] **Step 4: store.ts** — replace the `termNonce`/`restartTerminal` fields with the terminals model. Final relevant shape:

```ts
export interface TerminalEntry {
  id: string;          // renderer-side uid (not the pty id)
  title: string;
  renamed: boolean;    // user renamed -> OSC title updates stop applying
  ptyId: string | null;
}

interface AppState {
  // ...existing fields (root, selectedFile, file, diff, secrets, config, gitStatus, modal)...
  terminals: TerminalEntry[];
  activeTerminalId: string | null;
  splitTerminalId: string | null;   // second visible pane; null = no split
  maximized: boolean;
  addTerminal: () => string;        // returns new id, sets active
  removeTerminal: (id: string) => void;
  setActiveTerminal: (id: string) => void;
  setTerminalPty: (id: string, ptyId: string) => void;
  setTerminalTitle: (id: string, title: string, fromUser: boolean) => void;
  setSplit: (id: string | null) => void;
  toggleMaximized: () => void;
}
```

Implementation notes (write it exactly like this):

```ts
let termCounter = 0;
const newEntry = (): TerminalEntry => ({
  id: `term-${++termCounter}`,
  title: "zsh",
  renamed: false,
  ptyId: null,
});
```

```ts
  terminals: [],
  activeTerminalId: null,
  splitTerminalId: null,
  maximized: false,
  addTerminal: () => {
    const entry = newEntry();
    set((s) => ({ terminals: [...s.terminals, entry], activeTerminalId: entry.id }));
    return entry.id;
  },
  removeTerminal: (id) =>
    set((s) => {
      const terminals = s.terminals.filter((t) => t.id !== id);
      const splitTerminalId = s.splitTerminalId === id ? null : s.splitTerminalId;
      let activeTerminalId = s.activeTerminalId;
      if (activeTerminalId === id) {
        activeTerminalId = terminals[terminals.length - 1]?.id ?? null;
      }
      return { terminals, splitTerminalId, activeTerminalId };
    }),
  setActiveTerminal: (id) => set({ activeTerminalId: id }),
  setTerminalPty: (id, ptyId) =>
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === id ? { ...t, ptyId } : t)),
    })),
  setTerminalTitle: (id, title, fromUser) =>
    set((s) => ({
      terminals: s.terminals.map((t) => {
        if (t.id !== id) return t;
        if (!fromUser && t.renamed) return t;
        return { ...t, title, renamed: fromUser ? true : t.renamed };
      }),
    })),
  setSplit: (id) => set({ splitTerminalId: id }),
  toggleMaximized: () => set((s) => ({ maximized: !s.maximized })),
```

`setRoot` additionally resets: `terminals: [], activeTerminalId: null, splitTerminalId: null, maximized: false` (panes unmount → each kills its PTY → fresh default tab is created by TerminalManager's effect — Task 2).

- [ ] **Step 5: verify** — typecheck will FAIL in App/SecretsSection (termNonce gone) — expected mid-task; fix App.tsx minimally NOW by removing the `termNonce` read and the `key={...nonce}` (leave the single `<TerminalPane ...>` as `<TerminalPane key={root ?? "no-workspace"} />` TEMPORARILY — Task 2 replaces it), and in SecretsSection replace `restartTerminal()` calls with a TEMPORARY no-op comment `/* restart wired in Task 5 */` (delete the import). Then: typecheck clean, `npm test` 96, lint clean.

- [ ] **Step 6: Commit** — `feat(app): pty:kill channel + terminal list store model`

---

### Task 2: TerminalPane refactor + TerminalManager

**Files:**
- Modify: `packages/app/src/renderer/src/components/TerminalPane.tsx`
- Create: `packages/app/src/renderer/src/components/TerminalManager.tsx`
- Modify: `packages/app/src/renderer/src/App.tsx`
- Modify: `packages/app/src/renderer/src/theme.css`

- [ ] **Step 1: TerminalPane.tsx** — full replacement:

```tsx
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { useApp } from "../store";

export function TerminalPane({ terminalId }: { terminalId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const setTerminalPty = useApp((s) => s.setTerminalPty);
  const setTerminalTitle = useApp((s) => s.setTerminalTitle);
  const removeTerminal = useApp((s) => s.removeTerminal);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'SF Mono', Menlo, monospace",
      cursorBlink: true,
      theme: {
        background: "#0d1117",
        foreground: "#c9d1d9",
        cursor: "#58a6ff",
        selectionBackground: "#1f3a5f",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    let ptyId: string | null = null;
    let exited = false;
    let offData = () => {};
    let offExit = () => {};
    let disposed = false;

    window.airlock
      .ptyCreate(term.cols, term.rows)
      .then((id) => {
        if (disposed) {
          // Late resolve after unmount: the session would orphan; kill it.
          window.airlock.ptyKill(id);
          return;
        }
        ptyId = id;
        setTerminalPty(terminalId, id);
        offData = window.airlock.onPtyData((e) => {
          if (e.id === id) term.write(e.data);
        });
        offExit = window.airlock.onPtyExit((e) => {
          if (e.id === id) {
            exited = true;
            removeTerminal(terminalId);
          }
        });
      })
      .catch(console.error);

    const input = term.onData((data) => {
      if (ptyId) window.airlock.ptyInput(ptyId, data);
    });

    const title = term.onTitleChange((t) => {
      if (t.trim()) setTerminalTitle(terminalId, t, false);
    });

    const ro = new ResizeObserver(() => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return; // hidden tab
      fit.fit();
      if (ptyId) window.airlock.ptyResize(ptyId, term.cols, term.rows);
    });
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      input.dispose();
      title.dispose();
      offData();
      offExit();
      // Tab closed / root changed: the session must die with the pane.
      if (ptyId && !exited) window.airlock.ptyKill(ptyId);
      term.dispose();
    };
  }, [terminalId, setTerminalPty, setTerminalTitle, removeTerminal]);

  return <div ref={hostRef} className="terminal-host" />;
}
```

- [ ] **Step 2: TerminalManager.tsx:**

```tsx
import { useEffect } from "react";
import { useApp } from "../store";
import { TerminalPane } from "./TerminalPane";
import { TerminalTabs } from "./TerminalTabs";

export function TerminalManager() {
  const terminals = useApp((s) => s.terminals);
  const activeTerminalId = useApp((s) => s.activeTerminalId);
  const splitTerminalId = useApp((s) => s.splitTerminalId);
  const addTerminal = useApp((s) => s.addTerminal);

  // Always keep at least one terminal alive.
  useEffect(() => {
    if (terminals.length === 0) addTerminal();
  }, [terminals.length, addTerminal]);

  const visible = (id: string) => id === activeTerminalId || id === splitTerminalId;

  return (
    <div className="terminal-manager">
      <TerminalTabs />
      <div className={`terminal-panes${splitTerminalId ? " split" : ""}`}>
        {terminals.map((t) => (
          <div key={t.id} className={`terminal-pane-slot${visible(t.id) ? "" : " hidden"}`}>
            <TerminalPane terminalId={t.id} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

(NOTE: TerminalTabs is created in Task 3 — for THIS task create a placeholder `TerminalTabs.tsx` exporting an empty strip `<div className="terminal-tabs" />` so the manager compiles; Task 3 fills it.)

- [ ] **Step 3: App.tsx** — replace the single `<TerminalPane key=... />` inside `.terminal-slot` with `<TerminalManager />`; add `maximized` from the store and put it on the shell: `<div className={`app-shell${maximized ? " maximized" : ""}`}>`.

- [ ] **Step 4: theme.css:**

```css
.terminal-manager {
  display: grid;
  grid-template-rows: 30px minmax(0, 1fr);
  height: 100%;
}

.terminal-panes {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;
}

.terminal-panes.split {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.terminal-panes.split .terminal-pane-slot:not(.hidden):first-of-type {
  border-right: 1px solid var(--border);
}

.terminal-pane-slot {
  min-width: 0;
  min-height: 0;
}

.terminal-pane-slot.hidden {
  display: none;
}

.app-shell.maximized .sidebar,
.app-shell.maximized .viewer-pane {
  display: none !important;
}
```

NOTE on hidden panes: `display: none` gives the host 0×0 — the pane's ResizeObserver guard skips fitting while hidden and refits on reveal (the observer fires when dimensions change back). xterm buffers survive because the component never unmounts.

- [ ] **Step 5: verify** — typecheck, 96 tests, lint; boot ~18s: exactly ONE terminal spawns (the manager effect), prompt works; no extra sessions; no React key warnings. Kill only your tree.

- [ ] **Step 6: Commit** — `feat(app): terminal manager — multiple mounted panes, kill-on-close, auto default tab`

---

### Task 3: Tab strip UI + rename + OSC titles

**Files:**
- Modify: `packages/app/src/renderer/src/components/TerminalTabs.tsx` (replace placeholder)
- Modify: `packages/app/src/renderer/src/theme.css`

- [ ] **Step 1: TerminalTabs.tsx:**

```tsx
import { useState } from "react";
import { useApp } from "../store";

export function TerminalTabs() {
  const terminals = useApp((s) => s.terminals);
  const activeTerminalId = useApp((s) => s.activeTerminalId);
  const splitTerminalId = useApp((s) => s.splitTerminalId);
  const maximized = useApp((s) => s.maximized);
  const addTerminal = useApp((s) => s.addTerminal);
  const removeTerminal = useApp((s) => s.removeTerminal);
  const setActiveTerminal = useApp((s) => s.setActiveTerminal);
  const setTerminalTitle = useApp((s) => s.setTerminalTitle);
  const setSplit = useApp((s) => s.setSplit);
  const toggleMaximized = useApp((s) => s.toggleMaximized);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const kill = (id: string) => {
    const entry = terminals.find((t) => t.id === id);
    if (entry?.ptyId) window.airlock.ptyKill(entry.ptyId);
    // pty exit will removeTerminal; remove eagerly too for instant UI.
    removeTerminal(id);
  };

  const splitActive = () => {
    if (splitTerminalId) {
      setSplit(null);
      return;
    }
    const id = addTerminal();
    // addTerminal made it active; keep the previous one active, show new in split.
    if (activeTerminalId) setActiveTerminal(activeTerminalId);
    setSplit(id);
  };

  return (
    <div className="terminal-tabs">
      <div className="terminal-tabs-list">
        {terminals.map((t) => (
          <div
            key={t.id}
            className={`terminal-tab${t.id === activeTerminalId ? " active" : ""}${
              t.id === splitTerminalId ? " in-split" : ""
            }`}
          >
            {renaming === t.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = draft.trim();
                  if (name) setTerminalTitle(t.id, name, true);
                  setRenaming(null);
                }}
              >
                <input
                  className="terminal-tab-rename"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => setRenaming(null)}
                  spellCheck={false}
                />
              </form>
            ) : (
              <button
                type="button"
                className="terminal-tab-label"
                onClick={() => setActiveTerminal(t.id)}
                onDoubleClick={() => {
                  setRenaming(t.id);
                  setDraft(t.title);
                }}
                title={t.title}
              >
                <i className="codicon codicon-terminal" />
                <span className="terminal-tab-title">{t.title}</span>
              </button>
            )}
            <button
              type="button"
              className="terminal-tab-close"
              title="Kill terminal"
              onClick={() => kill(t.id)}
            >
              <i className="codicon codicon-close" />
            </button>
          </div>
        ))}
        <button type="button" className="terminal-tab-action" title="New terminal" onClick={() => addTerminal()}>
          <i className="codicon codicon-add" />
        </button>
      </div>
      <div className="terminal-tabs-actions">
        <button
          type="button"
          className="terminal-tab-action"
          title={splitTerminalId ? "Unsplit" : "Split terminal"}
          onClick={splitActive}
        >
          <i className="codicon codicon-split-horizontal" />
        </button>
        <button
          type="button"
          className="terminal-tab-action"
          title={maximized ? "Restore layout" : "Maximize terminal"}
          onClick={toggleMaximized}
        >
          <i className={`codicon codicon-screen-${maximized ? "normal" : "full"}`} />
        </button>
      </div>
    </div>
  );
}
```

CODICON NOTE: verify `terminal`, `split-horizontal`, `screen-full`, `screen-normal` exist in the installed set (grep dist/codicon.css); substitute nearest + report if missing — sanctioned.

- [ ] **Step 2: theme.css:**

```css
.terminal-tabs {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  padding: 0 6px;
  min-width: 0;
}

.terminal-tabs-list {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  min-width: 0;
}

.terminal-tab {
  display: flex;
  align-items: center;
  border-radius: 4px;
  height: 24px;
}

.terminal-tab.active {
  background: var(--hover);
}

.terminal-tab.in-split {
  outline: 1px dashed var(--border);
}

.terminal-tab-label {
  display: flex;
  align-items: center;
  gap: 5px;
  background: none;
  border: none;
  color: var(--fg-dim);
  font-size: 12px;
  cursor: pointer;
  padding: 0 4px 0 6px;
  font-family: inherit;
  max-width: 160px;
}

.terminal-tab.active .terminal-tab-label {
  color: var(--fg);
}

.terminal-tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-tab-close {
  background: none;
  border: none;
  color: var(--fg-dim);
  cursor: pointer;
  padding: 0 4px;
  opacity: 0;
  transition: opacity 80ms linear;
}

.terminal-tab:hover .terminal-tab-close,
.terminal-tab:focus-within .terminal-tab-close {
  opacity: 1;
}

.terminal-tab-close:hover {
  color: #f85149;
}

.terminal-tab-action {
  background: none;
  border: none;
  color: var(--fg-dim);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
}

.terminal-tab-action:hover {
  background: var(--hover);
  color: var(--fg);
}

.terminal-tabs-actions {
  display: flex;
  gap: 2px;
  flex: none;
}

.terminal-tab-rename {
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 4px;
  color: var(--fg);
  font-size: 12px;
  padding: 1px 4px;
  width: 120px;
  font-family: inherit;
}
```

- [ ] **Step 3: verify** — typecheck, tests, lint; boot ~18s: tab strip renders with one "zsh" tab (title may update via OSC once the shell prints), + spawns a second tab and switches, ✕ kills (and the last-tab auto-respawn works — killing the only tab yields a fresh one), no warnings.

- [ ] **Step 4: Commit** — `feat(app): terminal tab strip — new/kill/switch, dblclick rename, OSC titles`

---

### Task 4: Split + maximize behaviors

**Files:**
- Modify: `packages/app/src/renderer/src/components/TerminalManager.tsx` (only if gaps emerge — the grid is already split-aware)
- Modify: `packages/app/src/renderer/src/store.ts` (guards)

- [ ] **Step 1: store guards** — in `removeTerminal`, ALSO: if after removal `terminals.length === 0`, splitTerminalId must be null (already handled by the filter ordering — verify); in `setActiveTerminal`, if the id equals `splitTerminalId`, swap: the split pane becomes active and the previous active takes the split slot:

```ts
  setActiveTerminal: (id) =>
    set((s) => {
      if (id === s.splitTerminalId) {
        return { activeTerminalId: id, splitTerminalId: s.activeTerminalId };
      }
      return { activeTerminalId: id };
    }),
```

- [ ] **Step 2: behavior verification matrix (manual reasoning + boot):**
  - split with 1 tab → creates tab 2, shows side-by-side, tab 1 stays active
  - clicking the split tab → swaps which is "active" (both stay visible)
  - clicking a third tab while split → it replaces the active pane; split pane persists
  - closing the split tab → unsplit, active remains
  - closing the active tab while split → split survives as the new active? (removeTerminal picks last tab as active — acceptable; verify no blank pane)
  - maximize hides sidebar + viewer; restore brings them back; split + maximize compose

- [ ] **Step 3: verify suite + boot; commit** — `feat(app): split-terminal swap semantics + maximize compose guards`

---

### Task 5: Secrets restart-hint rewire

**Files:**
- Modify: `packages/app/src/renderer/src/components/SecretsSection.tsx`

- [ ] **Step 1:** Replace the Task-1 temporary no-ops: the hint button becomes "restart active terminal":

```tsx
  const restartActive = () => {
    const { terminals, activeTerminalId, removeTerminal } = useApp.getState();
    const active = terminals.find((t) => t.id === activeTerminalId);
    if (active?.ptyId) window.airlock.ptyKill(active.ptyId);
    if (active) removeTerminal(active.id);
    // Manager auto-spawns a fresh tab when the list empties; if other tabs
    // remain, spawn a fresh one explicitly so the user lands in an injected shell.
    if (useApp.getState().terminals.length > 0) useApp.getState().addTerminal();
    setNeedsRestart(false);
  };
```

Hint copy becomes: `↻ new terminals get secrets — restart active` (button). Note in a comment: OTHER running terminals keep their old env (env applies at spawn); that is correct and intentional.

- [ ] **Step 2:** verify + boot; commit — `feat(app): secrets restart hint restarts the active terminal only`

---

### Task 6: Spec note + verify + repackage

- [ ] Spec §9: blockquote — terminal management revision (tabs/split/maximize/rename/OSC titles; pty:kill closes the skeleton's orphan-session TODO; termNonce retired).
- [ ] README: update the Git/Secrets blurbs' terminal mentions if stale; add one Terminal line (tabs, split, maximize).
- [ ] Full verify: 96 tests, typecheck, lint, ~18s boot; `npm run package`; packaged launch ~10s clean; kill only yours.
- [ ] Commit (NO tag): `docs: terminal tabs complete; repackaged`
- [ ] **HUMAN GATE:** tabs render; + / ✕ / switch / dblclick-rename work; OSC title updates when running a command (e.g. `vim` retitles); split side-by-side with working shells in both; maximize swallows sidebar+viewer and restores; killing the last tab respawns a fresh one; secrets restart hint replaces only the active terminal. Verdict → tag terminal-v0.5 + merge.

---

## Self-review

1. Screenshot features mapped: tabs+titles (T2/T3), + new (T3), kill (T1/T3), split (T3/T4), maximize (T2/T3), rename (T3), process titles (T3 via onTitleChange). Overflow menu from the screenshot intentionally omitted (no actions left to house) — note for the gate message.
2. No placeholders: complete code for store, panes, manager, tabs; Task 4 is guards + a verification matrix on already-written code.
3. Type consistency: TerminalEntry shared via store; ptyKill(id) string-guarded main-side; TerminalPane reports via store setters (terminalId keyed); App reads maximized; SecretsSection uses store.getState() snapshot pattern (no stale closures).
4. Lifecycle invariants: unmount ⇒ ptyKill (orphan TODO closed); exit ⇒ removeTerminal ⇒ manager refills last tab; late ptyCreate resolve after unmount ⇒ immediate kill (no orphan); hidden panes skip fit (0×0 guard) and refit on reveal.
5. agent-core untouched; one IPC channel added with the established guard pattern.
