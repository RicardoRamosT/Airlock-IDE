# Project Search (Find-in-Files) -- Design

**Date:** 2026-06-07
**Status:** Approved (pending spec review)
**Phase:** 1 (Navigable), sub-project 2 of 3 (palette -> **search** -> git-sync)

## Goal

Search the *contents* of every file in the active project for a piece of text,
show the hits grouped by file, and click a hit to open that file scrolled to the
matching line. (Complements Cmd+P, which finds a file by *name*.)

## Decisions (technical calls delegated to the implementer)

1. **Zero-dep Node scan** for the backend -- reuse `listFilesRecursive`
   (honors the `IGNORED` set) + `readWorkspaceFile` (skips binaries via its
   `binary` flag, 1 MB/file cap). In-process and auditable, no external binary.
   (ripgrep is a clean future upgrade if huge repos feel slow.)
2. **Window-level overlay** -- a top-level `searchOpen` state rendered in `App`
   (like the command palette), a full-area `<SearchPanel>`. Simpler than
   threading a new per-tab field through the whole `ProjectState`/`mirrorOf`/reset
   machinery, and the query + results persist in the store so reopening is
   instant.
3. **Jump to the matched line** -- clicking a result opens the file and scrolls
   CodeMirror to that line, via a per-tab "reveal" consumed by `EditorPane`.
4. **Search on Enter** -- the scan reads files, so it runs when the user presses
   Enter (not on every keystroke). Debounced live-search is a future refinement.
5. **Case-insensitive substring**, **active project only**.

## Non-goals (YAGNI for v1)

- Regex, whole-word, case-sensitive toggle, and search-and-replace.
- Multi-root / cross-pane search (active project only).
- Respecting `.gitignore` beyond the existing `IGNORED` set.
- Live-as-you-type search (Enter-triggered in v1).

## Architecture and components

### agent-core (`workspace/search.ts`, new)

```ts
export interface SearchMatch { line: number; col: number; preview: string }
export interface SearchFileResult { path: string; matches: SearchMatch[] }
export interface SearchResults { files: SearchFileResult[]; truncated: boolean }

export async function searchProject(
  root: string,
  query: string,
  opts?: { maxResults?: number; maxPerFile?: number },
): Promise<SearchResults>;
```

- Empty/whitespace `query` -> `{ files: [], truncated: false }` (no scan).
- Walk `listFilesRecursive(root)`; for each path, `readWorkspaceFile` -- skip when
  `binary` (no text to search). Scan each line for the query
  (case-insensitive via `toLowerCase`); record `{ line (1-based), col (match
  index in the original line), preview }` where `preview = rawLine.slice(0, 200)`
  (keeps `col` valid; long minified lines do not blow up the payload).
- Caps: `maxPerFile` (default 50) matches per file; `maxResults` (default 1000)
  total matches across files. On hitting `maxResults`, stop and set
  `truncated: true`. (`readWorkspaceFile`'s 1 MB cap also bounds per-file work.)
- ASCII-only file.

### IPC (main + preload + shared)

- `shared/ipc.ts`: re-export the search types; add to `AirlockApi`
  `searchProject(root: string, query: string): Promise<SearchResults>`; extend
  `MenuAction` with `{ type: "find-in-files" }`.
- `preload/index.ts`: wire `fs:search`.
- `main/ipc.ts`: `ipcMain.handle("fs:search", ...)` -> validate `query` string,
  `searchProject(resolveRoot(e, root), query)`.
- `main/menu.ts`: in the **Go** submenu add "Find in Files..." accelerator
  `CmdOrCtrl+Shift+F` -> `pushMenuAction({ type: "find-in-files" })`.
- `lib/useMenuActions.ts`: `find-in-files -> s.setSearchOpen(true)`.

### store (`store.ts`) -- all TOP-LEVEL (no per-tab `ProjectState` threading)

- `searchOpen: boolean` (default false) + `setSearchOpen(v: boolean)` -- the
  panel's visibility, window-level like the palette.
- `search: { query: string; results: SearchResults } | null` (default null) +
  `setSearchResults(query: string, results: SearchResults)` -- the last query and
  its results, kept in the store so closing/reopening the panel is instant.
- **Reveal (line-jump):** `reveal: { tabId: string; path: string; line: number;
  nonce: number } | null` + `revealLine(tabId, path, line)` (sets it with an
  incrementing `nonce` so clicking the same line twice still retriggers).
  `EditorPane` consumes it; the nonce guards against re-scrolling. (Top-level and
  keyed by `tabId`, so it never needs `ProjectState`/`mirrorOf` threading.)
- `openEditorFile(tabId, relPath, line?)` (in `lib/editorFiles.ts`): opens the
  file as today, and when `line` is given also calls `revealLine(tabId, relPath,
  line)`.

### renderer UI

- `components/SearchPanel.tsx` (new): a window-level overlay (backdrop + a large
  centered panel, like the command palette). A query `<input>` (search on Enter)
  + a loading state + the results from the store's `search`. Results grouped by
  file: a file header (path + match count) over match rows (`line#` + `preview`
  with the matched span highlighted via `col`/`query.length`, when `col` is within
  the preview). A truncation footer when `truncated`. Enter -> `searchProject` IPC
  -> `setSearchResults`. Clicking a match row -> `openEditorFile(activeTabId,
  path, line)` + `setSearchOpen(false)`. Esc / backdrop click closes. Reads the
  active tab's root; empty state when no folder is open.
- `components/App.tsx`: render `{searchOpen && <SearchPanel />}` alongside the
  palette / modals (window-level).
- `components/EditorPane.tsx`: keep the created `EditorView` in a ref; add an
  effect on `reveal` that, when `reveal.tabId === tabId && reveal.path ===
  relPath`, dispatches a CodeMirror scroll+selection to `reveal.line` (clamped to
  the doc). `reveal` (incl. `nonce`) is in the effect deps so repeated clicks
  re-scroll.
- `lib/commands.ts`: add a **Find in Files** command -> `s.setSearchOpen(true)`
  (so it is reachable from the command palette too).
- `theme.css`: `.search-panel`, `.search-input`, `.search-file`, `.search-row`,
  highlight span, truncation footer.

### Data flow

Cmd+Shift+F (or the palette command) -> `setSearchOpen(true)` -> `App` shows
`<SearchPanel>` -> user types + Enter -> `searchProject` IPC -> `setSearchResults`
-> grouped results -> click a match -> `openEditorFile(activeTabId, path, line)`
(opens + sets `reveal`) -> `EditorPane` scrolls to the line; the panel closes (its
query + results stay in the store, so reopening is instant).

## Error handling

- `searchProject` reject -> the panel shows an inline error; never crashes.
- Empty query -> no scan, empty results.
- `truncated` -> a visible "showing first N matches" footer (no silent cap).
- `reveal.line` beyond the doc (file changed) -> clamp to the last line.

## Testing

- `search.test.ts` (agent-core): finds matches across nested files; case-
  insensitive; reports `line`/`col`/`preview`; skips a binary file (NUL byte);
  prunes `IGNORED` dirs; sets `truncated` at `maxResults`.
- `components/SearchPanel.test.tsx` (jsdom): typing + Enter renders grouped
  results from a stubbed `searchProject`; clicking a match calls
  `openEditorFile(tabId, path, line)` and closes the panel.
- `store.test.ts` addition (or a focused test): `setSearchOpen` toggles the flag;
  `setSearchResults` stores the query + results; `revealLine` sets `reveal` with
  an incrementing nonce.

## Constraints

- ASCII-only in `agent-core/workspace/search.ts`, `main/ipc.ts`, `main/menu.ts`,
  `shared/ipc.ts`, `preload/index.ts` (CJS bundling -- use `--`).
- Renderer `.tsx`/`.css`/`.ts` and this doc are exempt.
