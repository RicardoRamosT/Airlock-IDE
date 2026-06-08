# File Management Design

**Goal:** Let the user mutate the project tree from AirLock's FileTree — create files/folders, rename, delete (to Trash), and duplicate — with the tree staying live as the agent, git, and the user all change files.

**Architecture:** Path-confined file operations live in `agent-core` (electron-free, unit-tested), mirroring the existing `writeWorkspaceFile`. The main process wires the IPC, performs Trash via Electron `shell.trashItem`, and runs a per-root `chokidar` watcher that is the single source of tree freshness. The renderer adds a FileTree context menu + inline editing and re-lists on watcher events; the store rewrites/closes open editor tabs when their file is renamed or deleted.

**Tech stack:** Electron + React 19 + Zustand + TypeScript; `chokidar` (new dependency) for the watcher; Electron `shell.trashItem` for recoverable deletes; vitest for tests.

---

## Scope

**v1 operations:** New File, New Folder, Rename, Delete (to Trash), Duplicate.

**Fast-follow (NOT in v1, but the design accommodates it):** drag-and-drop move within the tree. It reuses the same `fs:move(root, from, to)` handler that Rename uses, so move is almost entirely renderer (drag) work later.

**Out of scope (v1):**
- MCP/agent file tools. The agent already has `run_command` (shell), so it can `touch`/`mv`/`rm`; file management is UI-only for now. (The live watcher means those agent edits still show up in the tree.)
- Reveal in Finder / Copy path / Copy relative path (cheap later additions, not now).
- Multi-select operations.

---

## 1. File operations (`packages/agent-core/src/workspace/fileOps.ts`)

Pure, path-confined functions reusing `resolveWithin(root, relPath)` (the same guard `writeWorkspaceFile` uses) so every target stays inside `root`. No Electron imports (so they unit-test without a window).

```
createFile(root, relPath): Promise<void>      // fails if it exists; parent dir must already exist (no mkdir -p)
createDir(root, relPath): Promise<void>       // mkdir; fails if it exists
move(root, fromRel, toRel): Promise<void>     // rename OR move; fails if `to` exists
duplicate(root, relPath): Promise<string>     // copies file or dir; returns the new relPath ("name copy.ext")
```

Rules enforced here (defense-in-depth; the IPC layer also guards):
- `resolveWithin` rejects any path that escapes `root` (throws, surfaced to the renderer as an error).
- **Conflict:** create/move/duplicate reject when the destination already exists (no overwrite).
- **Duplicate naming:** `report.ts` -> `report copy.ts`; `report copy.ts` -> `report copy 2.ts`; a folder `src` -> `src copy`. Increment until free.
- `move`/`duplicate` of a directory copies recursively (Node `fs.cp` with `recursive`).

These never touch Trash (that needs Electron) — see IPC.

**Tests (`fileOps.test.ts`):** create/dir/move/duplicate happy paths; reject on existing destination; reject on path escaping root (`../`); duplicate name incrementing; recursive directory move/duplicate.

## 2. IPC handlers (`packages/app/src/main/ipc.ts`)

New handlers, all using the explicit-root pattern (`resolveRoot(e, root)`):

```
fs:create   (root, relPath)            -> fileOps.createFile
fs:mkdir    (root, relPath)            -> fileOps.createDir
fs:move     (root, fromRel, toRel)     -> fileOps.move
fs:duplicate(root, relPath)            -> fileOps.duplicate, returns new relPath
fs:trash    (root, relPath)            -> shell.trashItem(absolute path)  // recoverable delete
```

- **`.airlock` guard:** any handler whose target path's first segment is `.airlock` (or equals it) rejects with an error before doing anything. Vault metadata is never mutated from the UI.
- All paths are validated through `resolveWithin` inside `fileOps`; `fs:trash` resolves the absolute path with the same guard before calling `shell.trashItem`.
- Errors are returned to the renderer (rejected promise -> caught in the FileTree, shown inline).

## 3. Live watcher (`packages/app/src/main/`, e.g. `fsWatch.ts`)

- One `chokidar` watcher per **open root** (the window's open-roots set — the same set `resolveRoot`/`workspace:roots` already tracks). Started when a root is opened, disposed when it closes (and on window close).
- **Ignored:** `**/.git/**`, `**/node_modules/**`, `**/.airlock/**` (avoids churn spam; `.airlock` is not user-managed in the tree).
- **Debounce:** coalesce bursts (~150 ms) into a single notification.
- **Event:** emits `fs:changed` (payload: `{ root }`) to that window's `webContents`. v1 keeps it coarse (root-level "something changed") — the renderer re-lists what it has expanded. (A finer per-path payload is a later optimization.)
- Config (`chokidar.watch`): `ignoreInitial: true`, `awaitWriteFinish` for large writes.

## 4. Renderer — FileTree (`packages/app/src/renderer/src/components/FileTree.tsx`)

- **Context menu** (right-click a node or empty space), reusing the existing context-menu markup/styling (as in `MainTabs`): New File, New Folder, Rename, Delete, Duplicate. On `.airlock` (and its descendants) the mutating items are hidden/disabled.
- **Target resolution:** New File/Folder created inside the right-clicked **folder** (or the folder of a right-clicked file, or the root for empty-space). Rename/Delete/Duplicate act on the clicked node.
- **Inline editing:** New File/Folder and Rename render an inline `<input>` in the tree row (no modal). Enter commits (calls the IPC), Escape cancels, blur cancels. Invalid/conflicting names show an inline error and keep the input open.
- **Freshness:** a `useFsWatch(root)` hook subscribes to `fs:changed` and re-lists the tree (the expanded directories). This is the single refresh path — UI ops, agent terminal commands, and git all surface the same way. (After a UI op, the watcher fires within the debounce window and the tree updates; no separate optimistic update.)
- **Delete confirm:** deleting a **non-empty folder** prompts a confirm; files and empty folders delete straight to Trash.

## 5. Open-tab / scene sync (`packages/app/src/renderer/src/store.ts`)

When a file is renamed/moved or deleted, open editor state must follow (the scene model references file paths in `editorTabs`, `current`, `splits`, `mainTabOrder`):

- **Rename/move** `from -> to`: a store action `renameFilePath(from, to, tabId?)` rewrites every matching `{ kind: "file", path: from }` to `path: to` across `editorTabs`, `mainTabOrder`, `splits` pairs, and `current`; derived `mainPrimary`/`mainSecondary`/`selectedFile` recompute via `setView`. Renaming a folder rewrites every open file whose path is under `from/`.
- **Delete:** route through the existing `closeEditorTab(path)` for each open file at/under the deleted path (which already drops it from `editorTabs`, `mainTabOrder`, `splits`, and re-focuses).

The FileTree calls these store actions right after the IPC op resolves (the watcher refreshes the tree; the store keeps the editor panes consistent).

## 6. Error handling & edge cases

- **Name conflict / invalid name:** inline error on the tree input; no overwrite, op not performed.
- **Path escape:** impossible from the UI, but `resolveWithin` rejects defensively.
- **`.airlock`:** blocked in the UI (no menu items) and in the handlers (defense-in-depth).
- **Op failure (permissions, races):** the rejected IPC promise is caught; show a brief inline error; the watcher keeps the tree truthful regardless.
- **Trash unavailable:** `shell.trashItem` failure surfaces as an error (no silent permanent delete fallback).

## 7. Testing

- **agent-core `fileOps.test.ts`:** create/mkdir/move/duplicate happy paths; reject-on-exists; reject path-escape (`../`); duplicate name incrementing; recursive dir move/duplicate.
- **store tests:** `renameFilePath` rewrites an open file in `editorTabs`/`splits`/`current`; folder rename rewrites nested open files; delete closes the open tab and clears it from a split.
- **component test (jsdom):** FileTree context menu shows the five actions; `.airlock` node hides the mutating items; committing the inline rename input calls the right IPC.

---

## Build order (for the plan)

1. agent-core `fileOps` + tests (no UI).
2. IPC handlers (`fs:create/mkdir/move/duplicate/trash`) + `.airlock` guard; preload + `shared/ipc.ts` surface.
3. chokidar watcher + `fs:changed` event + `useFsWatch` hook.
4. FileTree context menu + inline editing, wired to the IPC; tree re-lists on `fs:changed`.
5. store `renameFilePath` + delete-sync; FileTree calls them.
6. Tests throughout; gate (typecheck + test + lint), then package for the user to gate.

**ASCII-only reminder:** `main/*`, `agent-core`, `shared/ipc.ts`, and `preload` are CJS-bundled — use `--` not em-dashes there. Renderer `.tsx`/`.css` and these docs are exempt.
