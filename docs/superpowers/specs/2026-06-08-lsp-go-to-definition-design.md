# LSP Slice 3 -- Go-to-definition -- Design

**Date:** 2026-06-08
**Status:** Approved (pending spec review)
**Phase:** 2 (Intelligent), LSP epic **slice 3 of 4** (foundation+diagnostics ✓ ->
hover+completions ✓ -> **go-to-definition** -> more languages/rename).

## Goal

On the slices 1-2 LSP foundation, add **go-to-definition**: Cmd-click a symbol in
a TS/JS file to jump to where it is defined, reusing the open-file + reveal-line
path that project search already uses.

## Decisions (technical calls delegated to the implementer)

1. **Trigger: Cmd-click only** (no F12, no context menu). A mouse handler in the
   editor resolves the click to a document offset and runs the jump; it
   suppresses the default text-selection for that click.
2. **Request/response**, like hover/completion: renderer asks main -> main asks
   the server -> one normalized location flows back. The renderer flushes the
   document first (`syncLspNow`) so the server answers against current text.
3. **Reuse `openEditorFile(tabId, relPath, line)`** (`lib/editorFiles.ts`) for
   navigation -- the same opener the file tree, tab bar, File menu, and search
   use. A cross-file jump opens (or switches to) the target editor tab in the
   active pane and reveals the line; a same-file jump just reveals.
4. **First result only.** `textDocument/definition` may return `Location |
   Location[] | LocationLink[]`; take the first and normalize to a
   workspace-relative path + 1-indexed line.
5. **Within-workspace only.** A definition whose file is outside the project root
   (e.g. `node_modules`, `lib.*.d.ts`) is a no-op in v1 (the editor only opens
   root-relative files).
6. **TS/JS only**, reusing `lspLanguageId` from slice 1.

## Non-goals (this slice)

- Definitions outside the workspace root (`node_modules` / bundled `lib.*.d.ts`)
  -- needs read-only external-file opening; future slice.
- Multi-result picker, peek / inline-popover definition, F12 / context-menu
  triggers.
- Cmd-hover underline affordance (mousemove tracking + decorations);
  go-to-type-definition, go-to-implementation, find-references.

## Architecture

### main -- `lsp/client.ts` (one request method + a pure normalizer)

```ts
import type { LspDefinition } from "../../shared/ipc"; // { relPath: string; line: number } (1-indexed)

// Pure + exported for tests: pick the first location from the server's reply and
// extract its uri + 0-indexed line. Handles a single Location ({ uri, range }),
// an array of Location, or an array of LocationLink ({ targetUri,
// targetSelectionRange | targetRange }). Returns null for empty/unrecognized.
export function firstDefinitionLocation(
  result: unknown,
): { uri: string; line: number } | null;

export async function lspDefinition(
  root: string,
  relPath: string,
  line: number,
  character: number,
): Promise<LspDefinition | null>;
```

- `lspDefinition`: `ensure(root)` + `await s.ready`, then
  `s.conn.sendRequest("textDocument/definition", { textDocument: { uri }, position: { line, character } })`.
- `firstDefinitionLocation` normalizes the three reply shapes to `{ uri, line }`
  (line = `range.start.line`, 0-indexed), first element of an array.
- `lspDefinition` then maps `uri -> relPath` via the existing
  `uriToRel(root, uri)` (slice 1). If `null` (outside the root) it returns
  `null`. Otherwise returns `{ relPath, line: loc.line + 1 }` -- the 0-indexed
  LSP line becomes the **1-indexed** line the reveal effect expects
  (`view.state.doc.line(lineNo)`), matching how search passes lines.
- A request that throws, a not-open file, or an out-of-root target -> `null`
  (never throws), like `lspHover`.

### IPC -- shared + preload + main

- `shared/ipc.ts` (ASCII): type
  ```ts
  export interface LspDefinition {
    relPath: string;
    line: number; // 1-indexed, ready for revealLine
  }
  ```
  and `AirlockApi`: `lspDefinition(root, relPath, line, character): Promise<LspDefinition | null>`.
- `preload/index.ts`: one `ipcRenderer.invoke` wire (`lsp:definition`).
- `main/ipc.ts`: a `lsp:definition` handler validating `line`/`character` are
  numbers, calling the client with `resolveRoot(e, root)` (mirrors
  `lsp:hover`/`lsp:completion`).

### renderer -- `components/EditorPane.tsx` (LSP files only)

- A module-level, exported-for-tests helper:
  ```ts
  export async function goToDefinition(
    root: string,
    relPath: string,
    tabId: string,
    sync: () => Promise<void>,
    docText: string,
    pos: number,
  ): Promise<void> {
    try {
      await sync(); // flush current text first, like completion/hover
      const { line, character } = positionAt(docText, pos);
      const def = await window.airlock.lspDefinition(root, relPath, line, character);
      if (def) await openEditorFile(tabId, def.relPath, def.line);
    } catch (err) {
      console.error("[lsp] go-to-definition failed", err);
    }
  }
  ```
- Add a Cmd-click handler to the editor extensions when `lspLang !== null`:
  ```ts
  EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!event.metaKey) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      event.preventDefault(); // suppress the default cursor/selection on this click
      void goToDefinition(root, relPath, tabId, syncLspNow, view.state.doc.toString(), pos);
      return true;
    },
  })
  ```
- `openEditorFile` is imported from `../lib/editorFiles`. `syncLspNow`, `root`,
  `relPath`, `tabId` are already in scope in the effect / props.

### Data flow

Cmd-click a symbol -> `mousedown` handler (metaKey) -> `posAtCoords` ->
`goToDefinition` -> `syncLspNow` + `lspDefinition` -> server -> first location
normalized to `{ relPath, line }` -> `openEditorFile` opens/switches the target
editor tab in this pane and reveals the line.

## Error handling

- No definition / non-symbol / outside-root / request rejects -> `lspDefinition`
  returns `null` -> `goToDefinition` is a no-op (no navigation, nothing surfaced).
- `posAtCoords` null (click past the text) -> handler returns without firing.
- `openEditorFile` already logs and swallows read failures.

## Testing

- `lspDefinition` normalizer (`firstDefinitionLocation`): single `Location`,
  `Location[]`, `LocationLink[]`, empty `[]` / `null` / unrecognized, and line
  extraction. Pure, no server.
- `goToDefinition` flow: mock `window.airlock.lspDefinition` + `openEditorFile`;
  assert it syncs first, then opens the returned target; a `null` result opens
  nothing.
- Live path (real server `textDocument/definition`) is **gated manually**
  (Cmd-click a symbol -> the editor jumps to its definition) plus a headless
  probe that drives `textDocument/definition` against the real server for a known
  symbol, like slices 1-2.

## Constraints

- ASCII-only in `lsp/client.ts`, `main/ipc.ts`, `shared/ipc.ts`,
  `preload/index.ts` (CJS bundling -- use `--`).
- Renderer `.tsx`/`.ts`/`.css` and this doc are exempt.
- No new dependency (LSP reply shapes handled structurally;
  `vscode-languageserver-protocol` is already present if a type is wanted).
- Reuses: `positionAt` (slice 2), `uriToRel` (slice 1), `syncLspNow` (slice 2),
  `openEditorFile` + `revealLine` (search), `lspLanguageId` (slice 1).
