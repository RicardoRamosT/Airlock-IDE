# Manual File Reordering -- Design

**Date:** 2026-06-07
**Status:** Approved (pending spec review)

## Goal

Let the user drag a file or folder to a custom position *within its folder* in
the file tree, and have that order persist and travel with the project. Folders
the user has never reordered keep the default sort (folders first, then A-Z).

## Background

The file tree currently lists a folder's contents via `listDirectory`
(`packages/agent-core/src/workspace/tree.ts`), which sorts folders-first then
`localeCompare` by name. Drag-and-drop already supports *moving* an entry into a
different folder (drop on a folder), onto a file's folder (drop on a file row),
or to the project root (drop on the tree background). What it does NOT do is
reorder entries within a folder -- dropping a file among its siblings is a
no-op, which is the gap this feature fills.

## Decisions (locked with the user)

1. **Custom order is a view concern, applied in the renderer.** `listDirectory`
   is unchanged and still returns the default-sorted list. The renderer applies
   the user's custom order on top, right before rendering. The agent, terminal,
   and git never see ordering -- it cannot corrupt anything on disk.
2. **Order travels with the project.** Persisted in a single committed file at
   the project root, keyed by *relative* folder paths so it is portable across
   machines and clones.
3. **Flat / full control once customized.** Once a folder has a custom order,
   files and folders may interleave freely (a file above a folder is allowed).
   Folders with no custom order still default to folders-first + A-Z.
4. **Reordering is within-folder only.** Cross-folder drags remain a plain
   move-into (the moved entry appends at the bottom of the destination's order).
   This avoids the much hairier "move AND position" combinatorics.

## Non-goals (YAGNI)

- Cross-folder "move to an exact position" in one gesture.
- Per-machine vs per-project toggle, or multiple sort modes (name/type/date).
- Reordering inside collapsed folders or via keyboard.
- Migrating/repairing order files written by a future schema version beyond a
  simple version check (unknown version => ignore the file, fall back to sort).

## The order file

Path: `<root>/.airlock-order.json`. One file per project.

```json
{
  "version": 1,
  "order": {
    ".": ["README.md", "src", "package.json"],
    "src": ["app.ts", "util.ts", "components"],
    "src/components": ["Button.tsx", "Input.tsx"]
  }
}
```

- Keys are folder relpaths (`"."` is the project root). Values are entry *names*
  (basenames, not paths) in the user's chosen order.
- A folder absent from `order` uses the default sort.
- **Visibility:** hidden from the file tree (added to the `IGNORED` set in
  `tree.ts`) so it does not clutter the tree -- like `.DS_Store`. It is NOT
  gitignored, so it commits and travels. It shows up in the Git section as a
  normal tracked file.
- **Watcher:** added to the chokidar `ignored` set in `fsWatch.ts` so writing it
  never triggers an `fs:changed` re-list loop.
- **Confinement:** all reads/writes go through `agent-core` via `resolveWithin`,
  so the path can never escape the project root. `.airlock-order.json` is not
  the `.airlock` vault dir, so `targetsVault` does not flag it.

## Reconciliation (`applyOrder`)

A pure function in the renderer, given the default-sorted `entries` for a folder
and the saved `names` array for that folder:

1. For each name in `names` that still exists in `entries` (matched by name) ->
   emit in saved order.
2. For each entry in `entries` NOT named in `names` (new since last save) ->
   append after, in the order `entries` already arrived (default sort).
3. Names in `names` with no matching entry (deleted/renamed) -> dropped.

Result: external changes never break the view. A new file lands at the bottom;
the user can drag it where they want. With no saved order, `applyOrder` returns
`entries` unchanged.

```ts
// packages/app/src/renderer/src/lib/fileOrder.ts
export function applyOrder(entries: DirEntry[], names: string[] | undefined): DirEntry[] {
  if (!names || names.length === 0) return entries;
  const byName = new Map(entries.map((e) => [e.name, e]));
  const ordered: DirEntry[] = [];
  for (const n of names) {
    const e = byName.get(n);
    if (e) { ordered.push(e); byName.delete(n); }
  }
  for (const e of entries) if (byName.has(e.name)) ordered.push(e);
  return ordered;
}
```

## Interaction model

A single drag has two possible intents, decided by *where on a row* the pointer
is during `dragover` (using `clientY` against the row's `getBoundingClientRect`):

- **Folder row, middle band** -> move INTO that folder (existing behavior).
- **Any row, top edge** -> insertion line ABOVE the row.
- **Any row, bottom edge** -> insertion line BELOW the row.
- **Tree background (empty space)** -> move to project root (existing).

Edge bands: top 30% / bottom 30% of a file row are the before/after zones (the
middle 40% also resolves to "after" for files, since a file has no "into"). For
a folder row: top 25% = before, bottom 25% = after, middle 50% = move-into.

An insertion drop **reorders only when the dragged item and the target row share
a parent** (same folder). The new order is computed from the folder's *currently
displayed* (post-`applyOrder`) entry names: remove the dragged name, reinsert it
at the target index (before/after the target), and persist the full names array.
If the dragged item lives in a different folder, the insertion line is not shown
and the drop falls back to the existing move-into behavior.

The drop-zone band detection is factored into a small pure helper
(`dropZone(rect, clientY, isDir) -> "before" | "after" | "into"`) so it is unit
testable without a DOM.

## Reset to auto-sort

A folder's right-click context menu gains **"Sort A-Z"** (shown only when that
folder has a saved custom order). It deletes the folder's key from `order` and
persists, returning the folder to the default sort.

## Components and data flow

- **`agent-core/src/workspace/fileOrder.ts`** (new): `readOrder(root)` ->
  `OrderFile` (or an empty map if the file is missing/malformed/wrong version);
  `setFolderOrder(root, folderRel, names)` read-modify-writes one folder's
  entry (empty `names` deletes the key); both path-confined via `resolveWithin`.
- **`agent-core/src/workspace/tree.ts`**: add `.airlock-order.json` to `IGNORED`.
- **`packages/app/src/main/ipc.ts`**: handlers `fileOrder:get` (root) and
  `fileOrder:set` (root, folderRel, names), validating root via `resolveRoot`.
- **`packages/app/src/main/fsWatch.ts`**: add `.airlock-order.json` to `ignored`.
- **`packages/app/src/preload`**: expose `getFileOrder(root)` and
  `setFileOrder(root, folderRel, names)`.
- **`packages/app/src/shared/ipc.ts`**: `OrderFile` / channel payload types.
- **`packages/app/src/renderer/src/store.ts`**: `fileOrder: Record<string,
  Record<string, string[]>>` keyed by root then folderRel; `loadFileOrder(root)`
  (idempotent; triggered by a `FileTree` effect on root change so a tree always
  has its order loaded -- no dependency on the open-folder flow) and
  `setFolderOrder(root, folderRel, names)` (write-through: optimistic store
  update + `setFileOrder` IPC).
- **`packages/app/src/renderer/src/lib/fileOrder.ts`** (new): pure `applyOrder`
  and `dropZone` helpers.
- **`packages/app/src/renderer/src/components/FileTree.tsx`**: apply `applyOrder`
  to listed entries in `FileTree` (root) and `DirNode`; add insertion-line drop
  zones + the reorder-on-drop logic; add the "Sort A-Z" menu item.
- **`packages/app/src/renderer/src/theme.css`**: `.tree-insert-line` style.

Data flow on reorder: drag a row -> `dragover` computes the zone + insertion
indicator -> drop in an insertion zone with a same-parent target -> FileTree
computes the new names array from the displayed order -> `setFolderOrder` updates
the store (instant re-render) and fires `setFileOrder` IPC -> main writes
`.airlock-order.json` (watcher ignores it). On project open, `loadFileOrder`
pulls the saved map into the store so the first render is already ordered.

## Error handling

- Malformed/unreadable/wrong-version order file -> treated as "no custom order"
  (default sort). Never throws into the render path.
- `setFileOrder` IPC rejection -> log and roll back the optimistic store update
  to the previous names so the view matches what is actually persisted.
- A reorder whose target is not a sibling -> no insertion line, no order write.

## Testing

- **`fileOrder.test.ts`** (agent-core): read missing file -> empty; round-trip
  write/read; wrong `version` -> empty; `setFolderOrder` with empty names deletes
  the key; writes are path-confined.
- **`lib/fileOrder.test.ts`** (renderer): `applyOrder` -- no saved order returns
  entries unchanged; saved order respected; new entry appended; deleted name
  dropped. `dropZone` -- before/after/into bands for file vs dir rects.
- **`FileTree.reorder.test.tsx`** (jsdom): dragging `a.ts` below `b.ts` in the
  same folder calls `setFileOrder(root, ".", ["b.ts", "a.ts", ...])`; dragging
  across folders does NOT call `setFileOrder` (falls back to move); "Sort A-Z"
  clears the folder's order.

## Constraints

- `agent-core/src/workspace/fileOrder.ts`, `main/*`, `shared/ipc.ts`, and
  `preload` are ASCII-only (CJS bundling). Use `--` not em-dashes there.
- Renderer `.tsx`/`.css`/`store.ts` and this doc are exempt.
