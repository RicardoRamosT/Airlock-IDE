# LSP Slice 2 -- Hover + Completions -- Design

**Date:** 2026-06-08
**Status:** Approved (pending spec review)
**Phase:** 2 (Intelligent), LSP epic **slice 2 of 4** (foundation+diagnostics ✓ ->
**hover+completions** -> go-to-definition -> more languages/rename).

## Goal

On the slice-1 LSP foundation, add **hover** (point at a symbol -> its type/doc in
a tooltip) and **completions** (real, typed autocomplete) for TS/JS. Purely
additive: same per-root `typescript-language-server`, document sync, and IPC --
the new piece is request/response round-trips (slice 1's diagnostics were
server-pushed).

## Decisions (technical calls delegated to the implementer)

1. **Request/response** for both: the renderer asks main -> main asks the server
   -> reply flows back. (No new server state.)
2. **Hover contents normalized to one markdown string IN the client** (the server
   returns MarkupContent / MarkedString / array / string) -- keeps the IPC payload
   a simple `{ contents: string }`.
3. **Completions apply as plain text** (`insertText ?? label`) -- no snippet
   placeholder expansion, no `completionItem/resolve`, no signature-help (later/
   YAGNI). The first response's `detail`/`documentation` populate the item.
4. **TS/JS only**, reusing `lspLanguageId` from slice 1.

## Non-goals (this slice)

- Snippet/placeholder insertion, `completionItem/resolve` (lazy docs),
  signature-help, auto-import code actions.
- Trigger-character popups (e.g. opening the menu the instant you type `.`) --
  v1 triggers on a word prefix or explicit invoke; member completions appear once
  you type a letter after `.`. (Trigger characters are a future refinement.)
- Go-to-definition (slice 3); non-TS/JS languages.

## Architecture

### main -- `lsp/client.ts` (two request methods, alongside `lspDid*`)

```ts
export async function lspHover(
  root: string, relPath: string, line: number, character: number,
): Promise<{ contents: string } | null>;

export async function lspCompletion(
  root: string, relPath: string, line: number, character: number,
): Promise<LspCompletionItem[]>;
```

- Both `ensure(root)` + `await s.ready`, then `s.conn.sendRequest("textDocument/
  hover" | "textDocument/completion", { textDocument: { uri }, position: { line,
  character } })`.
- `lspHover` normalizes the result's `contents` to a string (MarkupContent.value;
  join arrays with blank lines; a `{language, value}` MarkedString -> its value);
  returns null when the server returns null/empty.
- `lspCompletion` normalizes `CompletionList | CompletionItem[] | null` to an
  array and trims each item to `{ label, kind?, detail?, documentation? (string),
  insertText? }` (documentation flattened to string). A request that throws or a
  missing server returns `null` (hover) / `[]` (completion) -- never throws.

### IPC -- shared + preload + main

- `shared/ipc.ts` (ASCII): types
  ```ts
  export interface LspHover { contents: string }
  export interface LspCompletionItem {
    label: string;
    kind?: number;          // LSP CompletionItemKind
    detail?: string;
    documentation?: string;
    insertText?: string;
  }
  ```
  and `AirlockApi`: `lspHover(root, relPath, line, character): Promise<LspHover |
  null>`, `lspCompletion(root, relPath, line, character): Promise<LspCompletionItem[]>`.
- `preload`: two `ipcRenderer.invoke` wires (`lsp:hover`, `lsp:completion`).
- `main/ipc.ts`: two handlers validating `line`/`character` are numbers, calling
  the client with `resolveRoot(e, root)`.

### renderer -- pure helpers (unit-tested)

- `lib/lspPositions.ts` (new): `positionAt(text, offset): { line: number;
  character: number }` -- the inverse of slice 1's offset mapping (counts `\n`
  before `offset`; character = offset - lineStart). Clamped.
- `lib/lspCompletions.ts` (new): `toCmCompletions(items: LspCompletionItem[]):
  Completion[]` (`@codemirror/autocomplete` `Completion`): `label`, `type` from a
  `kind -> CM type` map (3 Function/2 Method -> "function"/"method", 6 Variable ->
  "variable", 5 Field/10 Property -> "property", 7 Class -> "class", 8 Interface ->
  "interface", 9 Module -> "namespace", 13 Enum -> "enum", 14 Keyword -> "keyword",
  else "variable"), `detail`, `info` from `documentation`, `apply` =
  `insertText ?? label`.

### renderer -- `components/EditorPane.tsx` (LSP files only)

- Add `@codemirror/autocomplete`'s `autocompletion({ override: [source] })` and
  `@codemirror/view`'s `hoverTooltip(source)` to the editor extensions when
  `lspLang !== null`.
- **Completion source** (`async (context) => CompletionResult | null`): take the
  cursor offset `context.pos`; if there is no word prefix and `!context.explicit`,
  return null; else `positionAt(doc, pos)` -> `window.airlock.lspCompletion(root,
  relPath, line, character)` -> `toCmCompletions(...)` -> return `{ from: <word
  start = context.matchBefore(/[\w$]*/)?.from ?? pos>, options, validFor: /[\w$]*/
  }` (so CM filters locally as more word chars are typed -- no round-trip per
  keystroke).
- **Hover source** (`async (view, pos) => Tooltip | null`): `positionAt(doc, pos)`
  -> `window.airlock.lspHover(...)` -> if `contents`, return `{ pos, end: pos,
  create: () => { dom = div.cm-lsp-hover; dom.textContent = contents; return { dom } } }`.

### Data flow

Type a few chars / Ctrl-Space -> CM completion source -> `lspCompletion` -> server
-> mapped options in the menu. Mouse-hover a symbol -> hover source -> `lspHover`
-> tooltip with the type/doc.

## Error handling

- A request that rejects or a not-yet-open file -> completion source returns null
  (no menu), hover source returns null (no tooltip). Never throws into the editor.
- Empty/whitespace completion list -> CM shows nothing (fine).
- `positionAt` clamps an out-of-range offset to the document.

## Testing

- `lib/lspPositions.test.ts`: `positionAt` maps offsets to line/character
  (multi-line, line start, end-of-doc clamp).
- `lib/lspCompletions.test.ts`: `toCmCompletions` maps kinds to CM types, uses
  `insertText ?? label` for `apply`, carries `detail`/`info`, handles `[]`.
- The live request path (real server hover/completion, CM menu + tooltip) is
  **gated manually** (open a `.ts`: type `something.` + a letter -> typed
  completions; hover a symbol -> a type tooltip). The EditorPane CM wiring is the
  fiddly part -> built on Opus.

## Constraints

- ASCII-only in `lsp/client.ts`, `main/ipc.ts`, `shared/ipc.ts`, `preload/index.ts`
  (CJS bundling -- use `--`).
- Renderer `.tsx`/`.ts`/`.css` and this doc are exempt.
- New dep: `@codemirror/autocomplete` (already transitively present via basicSetup).
