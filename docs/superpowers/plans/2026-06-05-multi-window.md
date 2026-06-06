# Multi-window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Per-window workspace (each window its own open folder); renderer IPC uses the sender window's root; the MCP agent follows the last-focused window; "New Window" in the dock + File menu. Single-window behavior unchanged.

**Architecture:** A new `main/window.ts` owns the per-window state (`workspaceRoots: Map<BrowserWindow.id, folder>` + `lastFocusedId`) and the window factory (`createWindow`, moved from index.ts, with focus/closed tracking). `ipc.ts` swaps the module-global `workspaceRoot` for per-window lookups keyed by the IPC event's sender window. The MCP `getWorkspaceRoot` dep becomes `lastFocusedRoot`.

**Tech Stack:** Electron (BrowserWindow, app.dock, Menu), TypeScript (strict), vitest, biome.

**Spec:** `docs/superpowers/specs/2026-06-05-multi-window-design.md`

**Constraints:** ASCII-only in all main/* files. Single-window must stay identical (one map entry = today). Do NOT change the renderer (already per-window: separate process/store per window).

---

## Task 1: main/window.ts (per-window state + window factory)

**Files:**
- Create: `packages/app/src/main/window.ts`
- Modify: `packages/app/src/main/index.ts` (import createWindow from window.ts; remove the local one)

- [ ] **Step 1: create window.ts** (ASCII-only). Copy createWindow's BrowserWindow options VERBATIM from the current index.ts createWindow (do not change width/height/webPreferences/security handlers):
```ts
// Per-window workspace state + the window factory. Each airlock window has its
// own open folder (workspaceRoots, keyed by BrowserWindow id). The MCP agent
// resolves to the LAST-FOCUSED window's root (the window you last used), which
// survives alt-tabbing away from airlock. ASCII-only: CJS-bundled into Electron
// main.
import { BrowserWindow, type WebContents } from "electron";
import path from "node:path";

const workspaceRoots = new Map<number, string>(); // BrowserWindow.id -> open folder
let lastFocusedId: number | null = null;

function winIdForSender(sender: WebContents): number | null {
  return BrowserWindow.fromWebContents(sender)?.id ?? null;
}

// The folder open in the window that sent an IPC event (or null).
export function rootForEvent(e: { sender: WebContents }): string | null {
  const id = winIdForSender(e.sender);
  return id === null ? null : (workspaceRoots.get(id) ?? null);
}

export function setRootForEvent(e: { sender: WebContents }, root: string): void {
  const id = winIdForSender(e.sender);
  if (id !== null) workspaceRoots.set(id, root);
}

export function clearRootForEvent(e: { sender: WebContents }): void {
  const id = winIdForSender(e.sender);
  if (id !== null) workspaceRoots.delete(id);
}

// The agent's root = the last-focused airlock window's folder, with fallbacks to
// the currently-focused window or any window that has a folder open.
export function lastFocusedRoot(): string | null {
  if (lastFocusedId !== null) {
    const r = workspaceRoots.get(lastFocusedId);
    if (r) return r;
  }
  const focused = BrowserWindow.getFocusedWindow();
  if (focused) {
    const r = workspaceRoots.get(focused.id);
    if (r) return r;
  }
  for (const r of workspaceRoots.values()) return r; // any window with a folder
  return null;
}

// New Window opens a fresh, no-folder airlock window.
export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#0d1117",
    title: "airlock",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.on("focus", () => {
    lastFocusedId = win.id;
  });
  win.on("closed", () => {
    workspaceRoots.delete(win.id);
    if (lastFocusedId === win.id) {
      lastFocusedId =
        BrowserWindow.getFocusedWindow()?.id ??
        BrowserWindow.getAllWindows()[0]?.id ??
        null;
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return win;
}
```
(Verify the BrowserWindow options against the real index.ts createWindow and match them exactly. If the preload path / load logic differs, copy the real version.)

- [ ] **Step 2: index.ts uses window.ts.** Remove the local `createWindow` function from index.ts; add `import { createWindow } from "./window";`. The existing `createWindow()` calls (bootstrap `:142`, `activate` `:180-182`) now use the imported one. Do NOT change the MCP dep wiring yet (Task 2). Confirm index.ts still compiles + the security handlers (setWindowOpenHandler/will-navigate) moved into window.ts (not duplicated in index.ts).

- [ ] **Step 3: typecheck + test + lint + commit.**
```bash
npm run typecheck && npm test && npm run lint
git add packages/app/src/main/window.ts packages/app/src/main/index.ts
git commit -m "feat(multi-window): main/window.ts -- per-window state + createWindow (focus/closed tracking)"
```
(Behavior is unchanged: window.ts's map is not yet read by ipc.ts; this just relocates createWindow + adds focus/closed tracking + the accessors for Task 2.)

---

## Task 2: ipc.ts -- per-window root sweep + MCP follows focus

**Files:**
- Modify: `packages/app/src/main/ipc.ts`
- Modify: `packages/app/src/main/index.ts` (MCP dep -> lastFocusedRoot)

- [ ] **Step 1: requireRoot takes the event.** Import the accessors: `import { rootForEvent, setRootForEvent, clearRootForEvent, lastFocusedRoot } from "./window";`. Change `requireRoot`:
```ts
function requireRoot(e: { sender: Electron.WebContents }): string {
  const root = rootForEvent(e);
  if (!root) throw new Error("No workspace open");
  return root;
}
```
Remove the module-global `let workspaceRoot` and the `getWorkspaceRoot`/`setWorkspaceRoot` exports (they are replaced by the window.ts accessors + lastFocusedRoot).

- [ ] **Step 2: sweep ALL requireRoot call sites to pass the event.** The Explore enumerated 24 sites. Apply the transform: every handler calls `requireRoot(e)` with its IPC event; handlers currently using `()` (no event arg) gain `(e)`; handlers using `(_e, ...)` rename to `(e, ...)`. The sites (channel @ line):
  - rename `_e`->`e` + `requireRoot(e)`: fs:listDir, fs:readFile, secrets:set, secrets:delete, secrets:reveal, clipboard:copySecret, secrets:importEnv, config:set, audit:read, git:stage, git:unstage, git:commit, git:switchBranch, git:createBranch, git:fileVersions.
  - add `(e)` arg + `requireRoot(e)`: secrets:list, config:get, git:isRepo, git:status, git:branches, db:list, host:localUrl.
  - `dbConnString(id)` calls requireRoot internally + is called by db:ping/db:tables/db:rows: change `dbConnString(e, id)` to take the event, pass `requireRoot(e)`; thread `e` from those 3 handlers (they have `_e` -> rename `e`).
  After the sweep, run `grep -n "requireRoot(" packages/app/src/main/ipc.ts` and confirm EVERY call passes an event (none bare `requireRoot()`).

- [ ] **Step 3: convert the direct workspaceRoot reads/writes to per-window.** Using the sender event where available:
  - `recordAndOpen(root)` -> `recordAndOpen(e, root)`: replace `workspaceRoot = root` with `setRootForEvent(e, root)`. Its callers `dialog:openFolder` (handler `async ()` -> add `(e)`) and `workspace:open` (`(_e, p)` -> `(e, p)`) pass their event.
  - `workspace:close` (`() => { workspaceRoot = null }`) -> `(e) => { clearRootForEvent(e); }`.
  - `dialog:openFile` (`async ()` -> `async (e)`): replace the 3 `workspaceRoot` reads with `const root = rootForEvent(e);` then use `root` (null -> return null; defaultPath: root; path.relative(root, picked)).
  - `github:info` (`async ()` -> `async (e)`): `const root = rootForEvent(e);` then `if (root) ... runGit(root, ...)`.
  - `render:services` (`async ()`... currently `() => renderServicesStatus(workspaceRoot)`) -> `(e) => renderServicesStatus(rootForEvent(e))`.
  - `activity:status` -> `(e) => activityStatus(rootForEvent(e))`.
  - `pty:create` (`(e, cols, rows)`, e already present): replace the 5 `workspaceRoot` reads with `const root = rootForEvent(e);` then use `root` for the guard / readProjectConfig / injectInto / appendAudit / cwd.

- [ ] **Step 4: MCP-facing reads -> lastFocusedRoot.** In `getTerminalTail`/`listTerminals` (module functions, no event), replace `workspaceRoot` with `lastFocusedRoot()`:
  - getTerminalTail: `const root = lastFocusedRoot(); if (!root) return { error: "No workspace open" };` then use `root` for allVaultedValues + appendAudit.
  - listTerminals: `const root = lastFocusedRoot();` then `const values = root ? await allVaultedValues(root) : [];`
  (Terminal-session filtering by window is Task 3; here just fix the root source.)

- [ ] **Step 5: index.ts MCP dep.** In `startMcpServer(port, {...})`, change `getWorkspaceRoot` to `getWorkspaceRoot: lastFocusedRoot` (import `lastFocusedRoot` from `./window`). Remove the now-dead `getWorkspaceRoot` import from `./ipc`. (server.ts/tools.ts `getWorkspaceRoot` dep name stays; only the supplied function changes.)

- [ ] **Step 6: typecheck + test + lint + commit.** Run `npm run typecheck && npm test && npm run lint`. Confirm: no bare `requireRoot()`; no remaining `workspaceRoot` references in ipc.ts except the window.ts-backed accessors. All tests green (the existing tests use one window's worth of state; with the per-window accessors keyed by sender, the test harness's events resolve correctly -- if a test mocks an event without a window, adapt the test or the accessor's null handling, reporting it).
```bash
git add packages/app/src/main/ipc.ts packages/app/src/main/index.ts
git commit -m "feat(multi-window): per-window root in every IPC handler; MCP follows the last-focused window"
```

---

## Task 3: terminal isolation + New Window (dock + File menu) + push targeting

**Files:**
- Modify: `packages/app/src/main/ipc.ts` (sessionWindows + terminal filtering)
- Modify: `packages/app/src/main/menu.ts` (New Window in File submenu; sections:changed -> all windows)
- Modify: `packages/app/src/main/index.ts` (dock menu)
- Modify: `packages/app/src/main/agent-requests.ts` (request-secret -> focused window)

- [ ] **Step 1: terminal-session ownership (ipc.ts).** Add `const sessionWindows = new Map<string, number>();` near `sessions`. In `pty:create`, after `sessions.set(s.id, s)`, record the owning window: `const ownerId = BrowserWindow.fromWebContents(e.sender)?.id; if (ownerId !== undefined) sessionWindows.set(s.id, ownerId);`. In `onExit`, also `sessionWindows.delete(s.id)`. In `getTerminalTail`/`listTerminals`, filter to the last-focused window's sessions:
```ts
// at the top of listTerminals / inside getTerminalTail, resolve the agent's window:
const winId = BrowserWindow.getFocusedWindow()?.id ?? /* last-focused */ ...;
```
Simplest: export a `lastFocusedWindowId()` from window.ts (returns the id used by lastFocusedRoot) so the terminal functions filter `sessions` to that window. In `listTerminals`, iterate only `sessionWindows` entries whose value === the agent window id; in `getTerminalTail(termId, ...)`, return `{ error: "No such terminal" }` if `sessionWindows.get(termId) !== agentWinId`. Use `lastFocusedRoot()`'s window for the vault (already done in Task 2). (If exposing the id is awkward, add `export function lastFocusedWindowId(): number | null` to window.ts mirroring lastFocusedRoot's resolution.)

- [ ] **Step 2: New Window in the File submenu (menu.ts).** Import `createWindow` from `./window`. Add as the FIRST File submenu item (before Open Folder), with a separator after the New Window/Open group as VS Code does:
```ts
{ label: "New Window", accelerator: "CmdOrCtrl+Shift+N", click: () => createWindow() },
{ type: "separator" },
```
(Place it at the top of the File submenu array.)

- [ ] **Step 3: dock menu (index.ts).** Add `Menu` to the electron import. In bootstrap (near the existing `app.dock.setIcon` block, but NOT gated on `!app.isPackaged`), add:
```ts
    if (process.platform === "darwin" && app.dock) {
      app.dock.setMenu(
        Menu.buildFromTemplate([
          { label: "New Window", click: () => createWindow() },
        ]),
      );
    }
```

- [ ] **Step 4: push targeting.**
  - menu.ts `changeSectionVisibility` (sections:changed) -> fan out to ALL windows:
```ts
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.webContents.isDestroyed()) w.webContents.send("sections:changed", next);
    }
```
  - agent-requests.ts `realNotify` -> target the focused/last-focused window:
```ts
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const wc = win?.webContents;
  if (!wc || wc.isDestroyed()) return false;
  wc.send("agent:request-secret", payload);
  return true;
```
  (menu:action / pushMenuAction already targets the focused window -- no change.)

- [ ] **Step 5: typecheck + test + lint + commit.**
```bash
npm run typecheck && npm test && npm run lint
git add packages/app/src/main/ipc.ts packages/app/src/main/menu.ts packages/app/src/main/index.ts packages/app/src/main/agent-requests.ts
git commit -m "feat(multi-window): per-window terminal isolation + New Window (dock + File menu) + push targeting"
```

---

## Task 4: docs + verify + repackage

- [ ] **Step 1: spec status** -> `**Status:** v1 complete.`
- [ ] **Step 2: docs.** Update `packages/app/resources/mcp-docs/` if any doc describes the workspace/one-project model -- note multi-window: the agent operates on the last-focused window's project (one at a time). README: add New Window (dock + File menu, Cmd+Shift+N) if it lists features. Skip if none fits; report.
- [ ] **Step 3: full verify.** `npm run typecheck && npm test && npm run lint && npm run build` -- all green; record the test count.
- [ ] **Step 4: repackage.** `npm run package` -- fresh .app; note the timestamp.
- [ ] **Step 5: commit.**
```bash
git add docs/ packages/app/resources/mcp-docs/ README.md
git commit -m "docs(multi-window): document per-window workspace + agent-follows-focus; verify + repackage"
```

---

## Self-review notes
- Single-window unchanged: one map entry, lastFocused = it, rootForEvent/lastFocusedRoot return it.
- Every requireRoot call passes the event (grep confirms no bare call); every direct workspaceRoot read/write converted; the global removed.
- MCP follows last-focused window (survives alt-tab via lastFocusedId, with fallbacks). One agent at a time (accepted limit).
- Terminal isolation: the agent only sees its window's terminals, redacted against that window's vault.
- Pushes: sections->all, request-secret->focused, menu:action->focused.
- New Window in dock (macOS) + File menu (Cmd+Shift+N) -> createWindow (fresh, no folder).
- ASCII-only in main/*.
