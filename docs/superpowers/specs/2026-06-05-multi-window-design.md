# Multi-window (per-window workspace, one agent follows focus)

**Date:** 2026-06-05
**Status:** Design approved (Option B). Building.

## Overview
Each airlock window gets its OWN open folder. Renderer IPC operates on the SENDER
window's root (window 2's tree/git/terminals/secrets are independent of window 1).
The MCP agent resolves to the LAST-FOCUSED airlock window's root -- so the agent
works on the window you are actually using, and that survives you alt-tabbing to
another app. "New Window" appears in the dock menu (right-click the dock icon) and
the File menu (Cmd+Shift+N), both opening a fresh no-folder window. Single-window
behavior is unchanged.

## The honest limit (accepted)
ONE agent session at a time. The single MCP server follows focus, so two
simultaneous agents in two windows would interfere -- that is the deferred Option
C (per-window MCP server). For Option B, you run the agent in the window you are
focused on; switching windows switches what the agent sees.

## Architecture
- **NEW `main/window.ts`** -- the per-window state + window factory:
  - `workspaceRoots: Map<number, string>` keyed by BrowserWindow id (the folder
    open in each window).
  - `lastFocusedId: number | null` -- updated on each window's `focus` event.
  - `createWindow(): BrowserWindow` -- MOVED from index.ts; adds `win.on("focus")`
    (-> lastFocusedId) and `win.on("closed")` (delete the window's root; recompute
    lastFocusedId if it was this window). A fresh window opens with NO folder.
  - accessors: `rootForEvent(e)` (the sender window's root or null),
    `setRootForEvent(e, root)`, `clearRootForEvent(e)`, and `lastFocusedRoot()`
    (the agent's root = the last-focused window's folder, with a focused-window /
    any-window-with-a-root fallback).
- **ipc.ts** -- `requireRoot(e)` takes the IPC event and returns
  `rootForEvent(e)` or throws "No workspace open". EVERY project-scoped handler is
  swept to pass its event (the Explore enumerated all 24 requireRoot sites + the
  direct workspaceRoot reads). `recordAndOpen`/`workspace:close`/`dialog:openFile`/
  `github:info`/`render:services`/`activity:status`/`pty:create` use the sender
  window. The old module-global `workspaceRoot` is removed; `getWorkspaceRoot`/
  `setWorkspaceRoot` are removed/repointed.
- **MCP** -- the `getWorkspaceRoot` dep passed to `startMcpServer` becomes
  `lastFocusedRoot`. The 4 MCP-facing reads in `getTerminalTail`/`listTerminals`
  also use `lastFocusedRoot`.
- **Terminal isolation** -- a `sessionWindows: Map<sessionId, number>` set in
  `pty:create` (the creating window). `listTerminals`/`getTerminalTail` filter to
  the last-focused window's sessions and redact with THAT window's vault -- so the
  agent only sees its own window's terminals, redacted against its own secrets.
- **Pushes** -- `sections:changed` (app-global visibility) -> ALL windows;
  `agent:request-secret` -> the focused/last-focused window; `menu:action` -> the
  focused window (already correct).
- **New Window** -- dock menu `app.dock?.setMenu([{ label: "New Window", click:
  createWindow }])` (macOS-guarded, near the existing dock-icon code); File submenu
  "New Window" (Cmd+Shift+N) -> createWindow (menu.ts imports createWindow from
  window.ts).

## MCP registration (unchanged, still works)
`registerMcpServer` is per-DIR (`claude mcp add --scope local` in the project dir).
Each window opening a folder registers that dir -> the ONE server URL. The single
server resolves requests to `lastFocusedRoot`. So N dirs -> 1 URL -> server picks
the focused window's root. No change to onFolderOpen.

## Single-window invariant
With one window: the map has one entry, lastFocusedId is that window,
`rootForEvent`/`lastFocusedRoot` both return its root -- behavior identical to
today. The refactor is backward-compatible.

## Security
No secret-value surface changes. Per-window roots actually TIGHTEN isolation
(window 2 can no longer read window 1's files/secrets via a stale global). The
terminal-isolation change makes get_terminal_tail redact against the correct
window's vault. ASCII-only in all main/* files touched.

## Out of scope
- Per-window MCP server / two simultaneous agents (Option C).
- Per-window app menu (the app menu is process-global on macOS -- correct).
- Restoring each window's folder across app restarts (windows open fresh; Open
  Recent is the path back).
