# LSP Slice 1 -- Foundation + Diagnostics -- Design

**Date:** 2026-06-08
**Status:** Approved (pending spec review)
**Phase:** 2 (Intelligent), LSP epic **slice 1 of 4** (foundation+diagnostics ->
hover+completions -> go-to-definition -> more languages/rename).

## Goal

Stand up the whole language-server pipeline for TypeScript/JS and deliver
**inline diagnostics (red/yellow squiggles)**: open a `.ts`/`.tsx`/`.js`/`.jsx`
file and see real type/syntax errors underlined as you type. This slice builds
the foundation (process, protocol, document sync) that hover/completions
(slice 2) and go-to-definition (slice 3) reuse.

## Decisions (locked with the user)

1. **TypeScript/JS only**; **diagnostics only** this slice (no hover/completion/
   go-to-def -- later slices).
2. **One language server per workspace root** (it needs the project root for
   `tsconfig`), spawned **lazily** on the first LSP-language file opened in that
   root, and disposed when no open window still has that root -- reusing the
   per-(window, root) tracking that already drives `fsWatch.ts`.
3. **Full-text document sync, debounced (~300 ms)** -- simplest correct sync;
   incremental sync is a future optimization.
4. **Transport:** `vscode-jsonrpc` (official `Content-Length` framing), message
   types from `vscode-languageserver-protocol`. The client lives in
   `packages/app/src/main/lsp/` (app infrastructure, like `main/mcp/`).
5. **New bundled deps approved:** `typescript-language-server`, `vscode-jsonrpc`,
   `vscode-languageserver-protocol`, `@codemirror/lint`. Pinned, vetted,
   own-process, secret-blind -- same posture as `node-pty`.

## Non-goals (this slice)

- Hover, completions, go-to-definition, signature help, rename, references,
  formatting, code actions (later slices).
- Languages other than TS/JS.
- Incremental document sync; multi-server-per-root.

## Architecture

```
EditorPane (renderer)            main: lsp/client.ts                 child process
 didOpen/didChange/didClose  --IPC-->  per-root LS registry  --stdio(JSON-RPC)-->  typescript-language-server
 setDiagnostics(squiggles)   <--IPC--  broadcast diagnostics  <--publishDiagnostics--
```

### main -- `packages/app/src/main/lsp/client.ts` (new)

- A per-root registry `Map<string, LspServer>`. `ensureServer(root)`:
  - spawn `typescript-language-server --stdio` (resolved from the bundled dep;
    run under Electron's Node mode -- `ELECTRON_RUN_AS_NODE` on `process.execPath`
    -- the standard way to run a bundled node CLI in a packaged Electron app),
  - wrap stdio in a `vscode-jsonrpc` connection,
  - send `initialize` (`rootUri` = `pathToFileURL(root)`, capabilities advertising
    `textDocument.publishDiagnostics` + full `synchronization`), then `initialized`.
- Methods `didOpen(relPath, languageId, version, text)`, `didChange(relPath,
  version, text)`, `didClose(relPath)` -- each resolves the path within the root
  (`resolveWithin`), builds the `file://` URI, and sends the matching
  `textDocument/*` notification.
- On `textDocument/publishDiagnostics {uri, diagnostics}` from the server,
  convert the URI back to a root-relative path and **broadcast**
  `lsp:diagnostics { root, relPath, diagnostics }` to all windows (like
  `sections:changed`); each editor filters to its own file.
- `disposeServer(root)`: `shutdown`/`exit` + kill the child. A
  `syncLspServers(openRoots)` (or the existing window-close hook) disposes
  servers for roots no longer open anywhere. Spawn failure / a missing server /
  a server crash is logged and leaves the editor simply without diagnostics --
  never crashes the app.
- ASCII-only file.

### IPC -- main + preload + shared

- `shared/ipc.ts`: a minimal diagnostic shape (decoupled from the protocol lib),
  ```ts
  export interface LspDiagnostic {
    range: { start: { line: number; character: number };
             end: { line: number; character: number } };
    severity: number; // LSP: 1 error, 2 warning, 3 info, 4 hint
    message: string;
  }
  ```
  and `AirlockApi` additions: `lspDidOpen(root, relPath, languageId, version,
  text)`, `lspDidChange(root, relPath, version, text)`, `lspDidClose(root,
  relPath)` (all `Promise<void>`), and `onLspDiagnostics(cb: (e: { root: string;
  relPath: string; diagnostics: LspDiagnostic[] }) => void): () => void`.
- `preload/index.ts`: wire `lsp:didOpen`/`lsp:didChange`/`lsp:didClose` and the
  `lsp:diagnostics` subscription.
- `main/ipc.ts`: handlers route each notification to `ensureServer(resolveRoot(e,
  root))` and call the matching method; the diagnostics broadcast originates in
  the client. (No secret value ever crosses; only file paths + text the user is
  already editing.)

### renderer

- `lib/lspLanguage.ts` (new, pure): `lspLanguageId(relPath): string | null`
  (ts/tsx/js/jsx/mts/cts/mjs/cjs -> "typescript"/"typescriptreact"/"javascript"/
  ..., else null). null => not an LSP file.
- `lib/lspDiagnostics.ts` (new, pure): `toCmDiagnostics(text: string,
  diags: LspDiagnostic[]): Diagnostic[]` -- convert each LSP `{line, character}`
  range to CodeMirror character offsets against `text`, mapping severity
  (1->"error", 2->"warning", else "info"). Out-of-range positions are clamped.
  Unit-testable without a DOM.
- `components/EditorPane.tsx`:
  - Add `@codemirror/lint` (`lintGutter()` + the lint field) to the editor
    extensions so diagnostics can be shown.
  - For an LSP-language file (`lspLanguageId(relPath) !== null`): on mount send
    `lspDidOpen` (version 1, full text); on each doc change send `lspDidChange`
    (debounced ~300 ms, incrementing a version ref, full text); on unmount send
    `lspDidClose`.
  - Subscribe to `onLspDiagnostics`; when an event matches this pane's `root` +
    `relPath`, `view.dispatch(setDiagnostics(view.state, toCmDiagnostics(doc,
    diags)))` via the existing `viewRef` (added for search reveal).

### Data flow

Open a `.ts` file -> `EditorPane` `lspDidOpen` -> main `ensureServer(root)`
(spawns + initializes if first) -> `didOpen` to the server -> server analyzes ->
`publishDiagnostics` -> main broadcasts `lsp:diagnostics` -> the owning
`EditorPane` maps + `setDiagnostics` -> squiggles. Typing -> debounced
`lspDidChange` -> fresh diagnostics.

## Error handling

- Server spawn fails / `typescript-language-server` unresolvable / server
  crashes -> logged once; the editor just shows no diagnostics (graceful).
- `lspDidChange`/`lspDidClose` for a root with no server -> no-op (a server is
  only created by `didOpen`).
- Diagnostics whose range exceeds the current buffer (raced edit) -> clamped to
  the doc by `toCmDiagnostics`.
- Disposing a window/root kills its server; a stray late diagnostic is dropped by
  the renderer's `(root, relPath)` filter.

## Testing

- `lib/lspLanguage.test.ts`: extension -> language id (incl. null for non-code).
- `lib/lspDiagnostics.test.ts`: `toCmDiagnostics` maps line/char to offsets,
  maps severities, clamps out-of-range positions, handles an empty list.
- The live client (real `typescript-language-server`, the handshake, end-to-end
  squiggles) is **gated manually** in the packaged app -- it is not reliably
  unit-testable. (Open a `.ts` with a deliberate type error -> squiggle appears;
  fix it -> squiggle clears; works in a split; closing the folder kills the
  server.) Implemented on Opus (the client + CodeMirror wiring are the bug-prone
  parts).

## Constraints

- ASCII-only in `packages/app/src/main/lsp/**`, `main/ipc.ts`, `shared/ipc.ts`,
  `preload/index.ts` (CJS bundling -- use `--`).
- Renderer `.tsx`/`.ts`/`.css` and this doc are exempt.
- Packaging: ensure `typescript-language-server` (and `typescript`) are included
  in the packaged app's `node_modules` (electron-builder) and resolvable at spawn
  time -- the riskiest packaging detail; verify in the manual gate.
