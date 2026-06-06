# File menu (VS Code-like, current capabilities)

**Date:** 2026-06-05
**Status:** Design approved. Building.

## Overview
Populate airlock's File menu (currently just "Close Window") with the file
actions airlock supports today (the viewer is read-only): **Open Folder, Open
File, Open Recent, Close Editor, Close Folder, Close Window**. "New Window" is
DEFERRED (it needs a multi-window / per-window-workspace refactor -- main is
single-window today: workspaceRoot is process-global and live pushes only target
the first window). The create/save items (New File, Save, Save As, Revert, Auto
Save) remain deferred to the file-editing feature.

## Items + accelerators
- **Open Folder...** (CmdOrCtrl+O) -- pick a project folder.
- **Open File...** (CmdOrCtrl+Shift+O) -- open a file (within the open folder)
  into the read-only viewer.
- **Open Recent** (submenu) -- recently opened folders, most-recent-first.
- **Close Editor** (CmdOrCtrl+W) -- close the viewer pane (back to full terminal).
- **Close Folder** -- clear the workspace (back to the no-folder state).
- **Close Window** (CmdOrCtrl+Shift+W) -- the existing role, remapped off Cmd+W.

(Cmd+W moves from Close Window to Close Editor, matching VS Code; Close Window
becomes Cmd+Shift+W. Close Editor/Close Folder are graceful no-ops when nothing is
open.)

## Architecture
- **menu.ts** builds the File submenu inside `applyAppMenu`, which gains a 3rd
  param `recentFolders` (so the Open Recent submenu reflects current state; the
  menu is already fully rebuilt via `applyAppMenu` on every change). A pure
  `recentSubmenuItems(recent, onPick)` helper mirrors `sectionSubmenuItems`
  (unit-tested). Both `applyAppMenu` call sites (index.ts bootstrap,
  changeSectionVisibility) pass the current recents.
- **Menu -> renderer**: each File click pushes a discriminated `menu:action` to
  the FOCUSED window's webContents (mirrors the `sections:changed` push). A single
  renderer subscriber dispatches by type.
- **Recents** persist in prefs: `AppPrefs.recentFolders: string[]` (capped ~10,
  most-recent-first, deduped, sanitized). Recorded on every open.
- **Open flow (main)**: an internal `recordAndOpen(root)` = setWorkspaceRoot +
  onFolderOpen (MCP re-register) + prepend-recent (savePrefs) + rebuild the menu
  (applyAppMenu with new recents). Used by both `dialog:openFolder` and the new
  `workspace:open`.
- **New main IPC**: `workspace:open(path)` (open a specific recent path),
  `workspace:close()` (clear workspaceRoot), `dialog:openFile()` (file dialog ->
  path RELATIVE to root, or null). `dialog:openFolder` gains recents-recording.
  Export `setWorkspaceRoot`.

## menu:action payloads + renderer reactions
- `{ type: "open-folder" }` -> renderer calls existing `openFolder()` -> `setRoot`.
- `{ type: "open-recent", path }` -> renderer calls `workspaceOpen(path)` ->
  `setRoot(path)`.
- `{ type: "open-file" }` -> renderer calls `openFile()` -> if a relPath returns,
  `readFile(relPath)` -> `setSelected(relPath, file)`.
- `{ type: "close-editor" }` -> renderer clears the viewer pane (`setSelected(null,
  null)`, `setDiff(null)`, `setSettingsOpen(false)`, `setDbView(null)`).
- `{ type: "close-folder" }` -> renderer calls `workspaceClose()` -> `setRoot(null)`.

## Honest scope / limits
- **Open File is within-workspace only**: the existing read path
  (`readWorkspaceFile` -> `resolveWithin`) is confined to the open folder + needs a
  folder open; the dialog returns a root-relative path. Opening files outside the
  workspace / with no folder is out of scope (would need a new unconfined read --
  deliberately not added).
- **Close Folder** leaves the prior MCP registration in place (there is no
  `onFolderClose` de-register); it points at a dir that is simply no longer open --
  acceptable v1.
- **New Window** deferred (multi-window refactor). **Editing items** deferred
  (read-only viewer).

## Security
No secret-value surface is touched. The new IPCs operate on workspace paths +
viewer state only. `dialog:openFile` returns a path (relative), not content; the
renderer reads content through the existing confined `fs:readFile`. ASCII-only in
main (menu.ts/ipc.ts/prefs.ts/index.ts); menu labels use ASCII "..." not an
ellipsis glyph.

## Out of scope
- Multi-window / per-window workspace ("New Window").
- File editing (New File / Save / Save As / Revert / Auto Save).
- Open file outside the workspace, or with no folder open.
- MCP de-registration on Close Folder.
