# LSP Slice 1 -- Foundation + Diagnostics -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a TS/JS file and see real type/syntax errors underlined (LSP diagnostics), via a bundled `typescript-language-server` running as a main-process child.

**Architecture:** A per-root LSP server (spawned under Electron's Node mode, JSON-RPC over stdio via `vscode-jsonrpc`) lives in `main/lsp`; its lifecycle mirrors `fsWatch` (per-root, reconciled by the window's open-roots, disposed on close). The renderer's `EditorPane` syncs the document (didOpen/didChange/didClose) over IPC and renders pushed `publishDiagnostics` through `@codemirror/lint`.

**Tech Stack:** Electron + electron-vite, React 19, CodeMirror, TypeScript (strict), vitest, biome. New deps: `typescript-language-server`, `vscode-jsonrpc`, `vscode-languageserver-protocol`, `@codemirror/lint`.

**Spec:** `docs/superpowers/specs/2026-06-08-lsp-foundation-diagnostics-design.md`

---

## Conventions for every task

- **ASCII-only** in `packages/agent-core/**`, `packages/app/src/main/**`,
  `packages/app/src/preload/**`, `packages/app/src/shared/ipc.ts` (CJS bundling;
  use `--`). Renderer `.tsx`/`.ts`/`.css` and this plan are exempt.
- Commands (repo root `/Users/ricardoramos/Projects/airlock`): one test file
  `npx vitest run <path>`; typecheck `npm run typecheck`; lint
  `npx biome check --write <paths>` then `npx biome check <paths>`.
- Branch: `feat/lsp-diagnostics` (already created). Do NOT push.
- **Execution:** Tasks 1 and 3 are mechanical (subagents). Tasks 2 (the LSP
  client) and 4 (EditorPane wiring) are bug-prone / not unit-testable -- ON OPUS,
  verified by typecheck + the full suite + manual gating.

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `packages/app/package.json` | add the 4 deps | 1 |
| `packages/app/src/renderer/src/lib/lspLanguage.ts` (new) | ext -> LSP languageId | 1 |
| `packages/app/src/renderer/src/lib/lspDiagnostics.ts` (new) | LSP diag -> CodeMirror diag | 1 |
| `packages/app/src/main/lsp/client.ts` (new) | per-root server: spawn, JSON-RPC, doc sync, diagnostics | 2 |
| `packages/app/src/shared/ipc.ts` | `LspDiagnostic` + `lspDid*`/`onLspDiagnostics` | 3 |
| `packages/app/src/preload/index.ts` | wire the lsp IPCs | 3 |
| `packages/app/src/main/ipc.ts` | lsp handlers + diagnostics broadcast | 3 |
| `packages/app/src/main/window.ts` | dispose servers on window close + roots reconcile | 3 |
| `packages/app/src/renderer/src/components/EditorPane.tsx` | doc sync + lint extension + diagnostics | 4 |

---

## Task 1: deps + pure renderer helpers

**Files:**
- Modify: `packages/app/package.json` (via `npm install`)
- Create: `packages/app/src/renderer/src/lib/lspLanguage.ts` + `.test.ts`
- Create: `packages/app/src/renderer/src/lib/lspDiagnostics.ts` + `.test.ts`

- [ ] **Step 1: Install the deps.**

```bash
npm install typescript-language-server vscode-jsonrpc vscode-languageserver-protocol @codemirror/lint -w @airlock/app
```
Confirm they appear in `packages/app/package.json` dependencies and `npm run typecheck` still passes.

- [ ] **Step 2: Write the failing tests.**

Create `packages/app/src/renderer/src/lib/lspLanguage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { lspLanguageId } from "./lspLanguage";

describe("lspLanguageId", () => {
  it("maps TS/JS extensions", () => {
    expect(lspLanguageId("a/b.ts")).toBe("typescript");
    expect(lspLanguageId("C.TSX")).toBe("typescriptreact");
    expect(lspLanguageId("x.js")).toBe("javascript");
    expect(lspLanguageId("y.jsx")).toBe("javascriptreact");
  });
  it("returns null for non-LSP files", () => {
    expect(lspLanguageId("readme.md")).toBeNull();
    expect(lspLanguageId("data.json")).toBeNull();
    expect(lspLanguageId("noext")).toBeNull();
  });
});
```

Create `packages/app/src/renderer/src/lib/lspDiagnostics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toCmDiagnostics } from "./lspDiagnostics";

const text = "const x = 1\nconsy y = 2\n";

describe("toCmDiagnostics", () => {
  it("maps line/char ranges to offsets and severities", () => {
    const out = toCmDiagnostics(text, [
      {
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
        severity: 1,
        message: "Cannot find name 'consy'.",
      },
    ]);
    expect(out).toEqual([
      { from: 12, to: 17, severity: "error", message: "Cannot find name 'consy'." },
    ]);
  });
  it("clamps out-of-range positions and handles empty", () => {
    expect(toCmDiagnostics(text, [])).toEqual([]);
    const out = toCmDiagnostics("abc", [
      {
        range: { start: { line: 9, character: 9 }, end: { line: 9, character: 9 } },
        severity: 2,
        message: "x",
      },
    ]);
    expect(out[0]).toEqual({ from: 3, to: 3, severity: "warning", message: "x" });
  });
});
```

Run both -> FAIL (modules missing).

- [ ] **Step 3: Implement `lspLanguage.ts`.**

```ts
// Map a file extension to its LSP languageId, or null when not an LSP-handled
// language (slice 1: TypeScript/JavaScript only).
const LANG: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascriptreact",
};

export function lspLanguageId(relPath: string): string | null {
  const i = relPath.lastIndexOf(".");
  if (i < 0) return null;
  return LANG[relPath.slice(i + 1).toLowerCase()] ?? null;
}
```

- [ ] **Step 4: Implement `lspDiagnostics.ts`.**

```ts
import type { Diagnostic } from "@codemirror/lint";
import type { LspDiagnostic } from "../../../shared/ipc";

// Start offset of each line (split on \n).
function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function offsetAt(
  starts: number[],
  textLen: number,
  line: number,
  character: number,
): number {
  if (line < 0) return 0;
  if (line >= starts.length) return textLen;
  return Math.min((starts[line] ?? 0) + Math.max(0, character), textLen);
}

const SEVERITY: Record<number, Diagnostic["severity"]> = {
  1: "error",
  2: "warning",
  3: "info",
  4: "info",
};

// Convert LSP diagnostics (line/character ranges) to CodeMirror diagnostics
// (character offsets), clamped to the document.
export function toCmDiagnostics(
  text: string,
  diags: LspDiagnostic[],
): Diagnostic[] {
  const starts = lineStartsOf(text);
  return diags.map((d) => {
    const from = offsetAt(starts, text.length, d.range.start.line, d.range.start.character);
    const to = Math.max(
      from,
      offsetAt(starts, text.length, d.range.end.line, d.range.end.character),
    );
    return { from, to, severity: SEVERITY[d.severity] ?? "info", message: d.message };
  });
}
```

- [ ] **Step 5: Run tests + typecheck + lint + commit.**

Run: `npx vitest run packages/app/src/renderer/src/lib/lspLanguage.test.ts packages/app/src/renderer/src/lib/lspDiagnostics.test.ts` -> PASS.
Run: `npm run typecheck` -> clean.
```bash
npx biome check --write packages/app/src/renderer/src/lib/lspLanguage.ts packages/app/src/renderer/src/lib/lspLanguage.test.ts packages/app/src/renderer/src/lib/lspDiagnostics.ts packages/app/src/renderer/src/lib/lspDiagnostics.test.ts
git add -A
git commit -m "feat(lsp): deps + pure lspLanguage/lspDiagnostics helpers"
```

---

## Task 2: the LSP client (ON OPUS)

**Files:**
- Create: `packages/app/src/main/lsp/client.ts`

Spawning the real server + the JSON-RPC handshake are not reliably unit-testable;
this task is verified by `npm run typecheck` + the manual gate. Build on Opus.

- [ ] **Step 1: Implement `packages/app/src/main/lsp/client.ts`.**

A per-root registry of servers. ASCII-only. Skeleton:

```ts
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createMessageConnection,
  type MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { resolveWithin } from "@airlock/agent-core";
import type { LspDiagnostic } from "../../shared/ipc";

interface Server {
  proc: ReturnType<typeof spawn>;
  conn: MessageConnection;
  ready: Promise<void>;
  open: Set<string>; // relPaths currently didOpen
}

// root -> server. One typescript-language-server per project root.
const servers = new Map<string, Server>();

// Push diagnostics to the app. Set by registerLspDiagnosticsSink (main wires it
// to a broadcast); kept as a sink so this file has no electron dependency.
let sink: (e: { root: string; relPath: string; diagnostics: LspDiagnostic[] }) => void =
  () => {};
export function onLspDiagnostics(
  fn: (e: { root: string; relPath: string; diagnostics: LspDiagnostic[] }) => void,
): void {
  sink = fn;
}

function startServer(root: string): Server {
  // Run the bundled CLI under Electron's Node mode (no separate node binary in a
  // packaged app). cli.mjs is the typescript-language-server entry.
  // main is bundled as CJS, so require.resolve works against node_modules.
  const cli = require.resolve("typescript-language-server/lib/cli.mjs");
  const proc = spawn(process.execPath, [cli, "--stdio"], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  proc.stderr?.on("data", (d) => console.error("[lsp]", String(d)));
  proc.on("error", (err) => console.error("[lsp] spawn failed", err));
  const conn = createMessageConnection(
    new StreamMessageReader(proc.stdout),
    new StreamMessageWriter(proc.stdin),
  );
  conn.onNotification(
    "textDocument/publishDiagnostics",
    (p: { uri: string; diagnostics: LspDiagnostic[] }) => {
      const rel = uriToRel(root, p.uri);
      if (rel !== null) sink({ root, relPath: rel, diagnostics: p.diagnostics ?? [] });
    },
  );
  conn.onError((e) => console.error("[lsp] conn error", e));
  conn.listen();
  const ready = conn
    .sendRequest("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(root).toString(),
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false },
          publishDiagnostics: {},
        },
      },
    })
    .then(() => {
      conn.sendNotification("initialized", {});
    });
  return { proc, conn, ready, open: new Set() };
}

function ensure(root: string): Server {
  let s = servers.get(root);
  if (!s) {
    s = startServer(root);
    servers.set(root, s);
  }
  return s;
}

async function uriOf(root: string, relPath: string): Promise<string> {
  return pathToFileURL(await resolveWithin(root, relPath)).toString();
}

function uriToRel(root: string, uri: string): string | null {
  try {
    const abs = decodeURIComponent(new URL(uri).pathname);
    const rel = path.relative(root, abs);
    return rel.startsWith("..") ? null : rel.split(path.sep).join("/");
  } catch {
    return null;
  }
}

export async function lspDidOpen(
  root: string,
  relPath: string,
  languageId: string,
  version: number,
  text: string,
): Promise<void> {
  const s = ensure(root);
  await s.ready;
  s.open.add(relPath);
  s.conn.sendNotification("textDocument/didOpen", {
    textDocument: { uri: await uriOf(root, relPath), languageId, version, text },
  });
}

export async function lspDidChange(
  root: string,
  relPath: string,
  version: number,
  text: string,
): Promise<void> {
  const s = servers.get(root);
  if (!s) return;
  await s.ready;
  s.conn.sendNotification("textDocument/didChange", {
    textDocument: { uri: await uriOf(root, relPath), version },
    contentChanges: [{ text }], // full-text sync
  });
}

export async function lspDidClose(root: string, relPath: string): Promise<void> {
  const s = servers.get(root);
  if (!s) return;
  s.open.delete(relPath);
  s.conn.sendNotification("textDocument/didClose", {
    textDocument: { uri: await uriOf(root, relPath) },
  });
}

function disposeServer(root: string): void {
  const s = servers.get(root);
  if (!s) return;
  servers.delete(root);
  try {
    s.conn.sendNotification("exit");
    s.conn.dispose();
  } catch {}
  s.proc.kill();
}

// Dispose servers for roots no longer open in ANY window.
export function syncLspServers(openRoots: string[]): void {
  const keep = new Set(openRoots);
  for (const root of [...servers.keys()]) if (!keep.has(root)) disposeServer(root);
}

export function disposeAllLspServers(): void {
  for (const root of [...servers.keys()]) disposeServer(root);
}
```

Notes for the Opus implementer: `vscode-jsonrpc/node` exports
`StreamMessageReader`/`StreamMessageWriter`. The main bundle is CJS, so
`require.resolve` works at runtime against the externalized `node_modules`; the
resolved `cli.mjs` runs as ESM under `ELECTRON_RUN_AS_NODE` (fine). `LspDiagnostic`
is added in Task 3; since Task 2 imports it, add that interface to `shared/ipc.ts`
as the first step here (Task 3 keeps the same definition).

- [ ] **Step 2: Typecheck.**

Run: `npm run typecheck` -> clean. (No unit test; behavior is gated manually after Task 4.)

- [ ] **Step 3: Lint + commit.**

```bash
npx biome check --write packages/app/src/main/lsp/client.ts
git add packages/app/src/main/lsp/client.ts
git commit -m "feat(lsp): per-root typescript-language-server client (spawn + JSON-RPC + doc sync)"
```

---

## Task 3: IPC + lifecycle wiring

**Files:**
- Modify: `packages/app/src/shared/ipc.ts`
- Modify: `packages/app/src/preload/index.ts`
- Modify: `packages/app/src/main/ipc.ts`
- Modify: `packages/app/src/main/window.ts`

- [ ] **Step 1: Add types + API (shared/ipc.ts).**

Add (near the other interfaces):

```ts
export interface LspDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity: number; // LSP: 1 error, 2 warning, 3 info, 4 hint
  message: string;
}
```

In `AirlockApi`:

```ts
  // Language server (slice 1: diagnostics). The renderer syncs the open doc;
  // diagnostics are pushed back. NO secret value crosses -- only file paths +
  // the text the user is editing.
  lspDidOpen(
    root: string,
    relPath: string,
    languageId: string,
    version: number,
    text: string,
  ): Promise<void>;
  lspDidChange(
    root: string,
    relPath: string,
    version: number,
    text: string,
  ): Promise<void>;
  lspDidClose(root: string, relPath: string): Promise<void>;
  onLspDiagnostics(
    cb: (e: {
      root: string;
      relPath: string;
      diagnostics: LspDiagnostic[];
    }) => void,
  ): () => void;
```

(If Task 2 already added `LspDiagnostic`, keep one copy.)

- [ ] **Step 2: Wire preload (preload/index.ts).**

```ts
  lspDidOpen: (root, relPath, languageId, version, text) =>
    ipcRenderer.invoke("lsp:didOpen", root, relPath, languageId, version, text),
  lspDidChange: (root, relPath, version, text) =>
    ipcRenderer.invoke("lsp:didChange", root, relPath, version, text),
  lspDidClose: (root, relPath) =>
    ipcRenderer.invoke("lsp:didClose", root, relPath),
  onLspDiagnostics: (cb) =>
    subscribe<{ root: string; relPath: string; diagnostics: LspDiagnostic[] }>(
      "lsp:diagnostics",
      cb,
    ),
```

(Import `LspDiagnostic` into the preload's type imports.)

- [ ] **Step 3: Handlers + diagnostics broadcast (main/ipc.ts).**

Import the client functions + register the diagnostics sink to broadcast to all
windows (mirror `broadcastActivityChanged`). At the top of `registerIpc` (or
module init), once:

```ts
  onLspDiagnostics((e) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.webContents.isDestroyed()) w.webContents.send("lsp:diagnostics", e);
    }
  });
```

Handlers (near the fs handlers; validate types):

```ts
  ipcMain.handle(
    "lsp:didOpen",
    (e, root: unknown, relPath: unknown, languageId: unknown, version: unknown, text: unknown) => {
      if (
        typeof relPath !== "string" ||
        typeof languageId !== "string" ||
        typeof version !== "number" ||
        typeof text !== "string"
      )
        throw new Error("Invalid payload");
      return lspDidOpen(resolveRoot(e, root), relPath, languageId, version, text);
    },
  );
  ipcMain.handle(
    "lsp:didChange",
    (e, root: unknown, relPath: unknown, version: unknown, text: unknown) => {
      if (typeof relPath !== "string" || typeof version !== "number" || typeof text !== "string")
        throw new Error("Invalid payload");
      return lspDidChange(resolveRoot(e, root), relPath, version, text);
    },
  );
  ipcMain.handle("lsp:didClose", (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    return lspDidClose(resolveRoot(e, root), relPath);
  });
```

In the existing `workspace:roots` handler (which already calls
`syncWindowWatchers(e.sender, list)`), also reconcile LSP servers against the
union of ALL windows' roots. Add a `syncLspServers(allOpenRoots())` call, where
`allOpenRoots()` is a small helper in `window.ts` (Step 4) returning the union of
`windowRoots`.

- [ ] **Step 4: Dispose on window close + roots reconcile (window.ts).**

- Add `export function allOpenRoots(): string[]` returning the de-duplicated
  union of every window's root set (`windowRoots`).
- In the window-close handler (where `windowRoots.delete(win.id)` +
  `disposeWindowWatchers(win.id)` run), after deleting, call
  `syncLspServers(allOpenRoots())` (import from `./lsp/client`) so a server whose
  root is no longer open anywhere is killed.

- [ ] **Step 5: Verify + commit.**

Run: `npm run typecheck` -> clean. Confirm ASCII-only on the four files.
```bash
npx biome check --write packages/app/src/shared/ipc.ts packages/app/src/preload/index.ts packages/app/src/main/ipc.ts packages/app/src/main/window.ts
git add packages/app/src/shared/ipc.ts packages/app/src/preload/index.ts packages/app/src/main/ipc.ts packages/app/src/main/window.ts
git commit -m "feat(lsp): lsp:did* IPC + diagnostics broadcast + server lifecycle"
```

---

## Task 4: EditorPane document sync + diagnostics (ON OPUS)

**Files:**
- Modify: `packages/app/src/renderer/src/components/EditorPane.tsx`

CodeMirror + live diagnostics aren't reliably unit-testable; gated manually. Opus.

- [ ] **Step 1: Add the lint extension.**

Import at top:

```ts
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { lspLanguageId } from "../lib/lspLanguage";
import { toCmDiagnostics } from "../lib/lspDiagnostics";
```

Add `lintGutter()` to the editor `extensions` array (so diagnostics render with a
gutter).

- [ ] **Step 2: Sync the document to the server.**

`EditorPane` already has `tabId`, `root`, `relPath`, `file`, the `viewRef`, and an
update listener. Add, inside the component:

```ts
  const lspLang = lspLanguageId(relPath);
```

In the main editor `useEffect` (which builds the view), when `lspLang` is set:
- after the view is created, `void window.airlock.lspDidOpen(root, relPath, lspLang, 1, file.content);` and keep a `let version = 1;`.
- in the existing `updateListener` (the one that sets dirty/autosave), also debounce a `lspDidChange`: on `docChanged`, after ~300 ms of quiet, `version += 1; void window.airlock.lspDidChange(root, relPath, version, view.state.doc.toString());` (a separate timer from the autosave one).
- in the effect cleanup, `if (lspLang) void window.airlock.lspDidClose(root, relPath);`.

(Only when `lspLang !== null`; non-code files do nothing.)

- [ ] **Step 3: Render pushed diagnostics.**

Add an effect that subscribes once and applies diagnostics for THIS file:

```ts
  useEffect(() => {
    if (!lspLang) return;
    return window.airlock.onLspDiagnostics((e) => {
      if (e.root !== root || e.relPath !== relPath) return;
      const view = viewRef.current;
      if (!view) return;
      view.dispatch(
        setDiagnostics(view.state, toCmDiagnostics(view.state.doc.toString(), e.diagnostics)),
      );
    });
  }, [lspLang, root, relPath]);
```

- [ ] **Step 4: Verify.**

Run: `npm run typecheck` -> clean.
Run: `npx vitest run packages/app/src/renderer/src/components/` -> all PASS
(existing EditorPane usage unaffected; no new unit test for the live path).
Run: `npx biome check --write packages/app/src/renderer/src/components/EditorPane.tsx` then `npx biome check` it.

- [ ] **Step 5: Commit.**

```bash
git add packages/app/src/renderer/src/components/EditorPane.tsx
git commit -m "feat(lsp): EditorPane document sync + inline diagnostics"
```

---

## Final verification (after all tasks)

- [ ] `npx vitest run` -- all green.
- [ ] `npm run typecheck` -- clean.
- [ ] `npx biome check .` -- clean.
- [ ] `npm run package` -- build for the owner to gate. **Confirm
  `typescript-language-server` is present under the packaged app's resources and
  the spawn resolves** (this is the most likely failure point).

## Manual gate checklist (owner)

- Open a `.ts` file in a TS project and introduce a type error (e.g. call a
  function with the wrong args) -> a red squiggle + message appears within a
  second; fix it -> the squiggle clears.
- A `.js` file behaves the same; a `.md`/`.json` file shows no LSP behavior.
- Diagnostics work in a split (two editors) and on the correct file only.
- Closing the folder / window stops the server (no lingering
  `typescript-language-server` process: `pgrep -fl typescript-language-server`).
- The agent/terminal still works; no secret values are involved.
