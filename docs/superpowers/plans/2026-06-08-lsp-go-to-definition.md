# LSP Slice 3 -- Go-to-definition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cmd-click a symbol in a TS/JS file to jump to its definition, reusing the existing open-file + reveal-line path.

**Architecture:** A pure normalizer turns `textDocument/definition`'s reply into a target; a `lspDefinition` client method maps it to a workspace-relative path + 1-indexed line; an `lsp:definition` IPC trio exposes it; `EditorPane` runs a Cmd-click handler that flushes the doc, asks the server, and calls `openEditorFile` to navigate.

**Tech Stack:** Electron + TypeScript, CodeMirror 6, vscode-jsonrpc (LSP over stdio), vitest, biome.

**Spec:** `docs/superpowers/specs/2026-06-08-lsp-go-to-definition-design.md`

**Refinement vs spec:** the pure `firstDefinitionLocation` normalizer lives in its own file `packages/app/src/main/lsp/definition.ts` (not inline in `client.ts`) so it is testable without importing the server-spawning module -- matching how slices 1-2 keep pure helpers in dedicated files.

**Execution (hybrid):** Tasks 1-3 are mechanical -> subagents. Task 4 (CodeMirror mouse-coords wiring) is bug-prone -> implement on Opus directly.

---

## File Structure

- Create `packages/app/src/main/lsp/definition.ts` -- pure `firstDefinitionLocation` normalizer (no electron/server deps).
- Create `packages/app/src/main/lsp/definition.test.ts` -- unit tests for the normalizer.
- Modify `packages/app/src/main/lsp/client.ts` -- add `lspDefinition` (imports the normalizer + reuses `uriToRel`, `uriOf`).
- Modify `packages/app/src/shared/ipc.ts` -- add `LspDefinition` type + `AirlockApi.lspDefinition`.
- Modify `packages/app/src/preload/index.ts` -- add the `lsp:definition` invoke wire.
- Modify `packages/app/src/main/ipc.ts` -- add the `lsp:definition` handler (import `lspDefinition`).
- Modify `packages/app/src/renderer/src/components/EditorPane.tsx` -- add exported `goToDefinition` + the Cmd-click `domEventHandler`.
- Create `packages/app/src/renderer/src/components/goToDefinition.test.tsx` -- unit test the flow.

---

## Task 1: Pure definition-result normalizer

**Files:**
- Create: `packages/app/src/main/lsp/definition.ts`
- Test: `packages/app/src/main/lsp/definition.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/main/lsp/definition.test.ts
import { describe, expect, it } from "vitest";
import { firstDefinitionLocation } from "./definition";

describe("firstDefinitionLocation", () => {
  it("reads a single Location", () => {
    const r = {
      uri: "file:///a/b.ts",
      range: { start: { line: 4, character: 2 }, end: { line: 4, character: 9 } },
    };
    expect(firstDefinitionLocation(r)).toEqual({ uri: "file:///a/b.ts", line: 4 });
  });

  it("reads the first of a Location[]", () => {
    const r = [
      { uri: "file:///a/b.ts", range: { start: { line: 7, character: 0 }, end: { line: 7, character: 3 } } },
      { uri: "file:///a/c.ts", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } } },
    ];
    expect(firstDefinitionLocation(r)).toEqual({ uri: "file:///a/b.ts", line: 7 });
  });

  it("reads the first of a LocationLink[] preferring targetSelectionRange", () => {
    const r = [
      {
        targetUri: "file:///a/d.ts",
        targetSelectionRange: { start: { line: 11, character: 4 }, end: { line: 11, character: 8 } },
        targetRange: { start: { line: 10, character: 0 }, end: { line: 12, character: 1 } },
      },
    ];
    expect(firstDefinitionLocation(r)).toEqual({ uri: "file:///a/d.ts", line: 11 });
  });

  it("falls back to targetRange when targetSelectionRange is absent", () => {
    const r = [
      { targetUri: "file:///a/e.ts", targetRange: { start: { line: 3, character: 0 }, end: { line: 3, character: 5 } } },
    ];
    expect(firstDefinitionLocation(r)).toEqual({ uri: "file:///a/e.ts", line: 3 });
  });

  it("returns null for null, empty array, and unrecognized shapes", () => {
    expect(firstDefinitionLocation(null)).toBeNull();
    expect(firstDefinitionLocation([])).toBeNull();
    expect(firstDefinitionLocation({ foo: 1 })).toBeNull();
    expect(firstDefinitionLocation({ uri: "file:///x.ts" })).toBeNull(); // no range
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/app/src/main/lsp/definition.test.ts`
Expected: FAIL -- cannot resolve `./definition` (file does not exist yet).

- [ ] **Step 3: Create the implementation**

```ts
// packages/app/src/main/lsp/definition.ts
// Pure normalizer for textDocument/definition replies. The server may return a
// single Location ({ uri, range }), an array of Location, or an array of
// LocationLink ({ targetUri, targetSelectionRange | targetRange }). Reduce any
// of these to the first target's uri + 0-indexed line, or null. ASCII-only
// (bundled into the CJS main).
export function firstDefinitionLocation(
  result: unknown,
): { uri: string; line: number } | null {
  const first = Array.isArray(result) ? result[0] : result;
  if (!first || typeof first !== "object") return null;
  const o = first as Record<string, unknown>;

  // LocationLink: targetUri + targetSelectionRange (preferred) or targetRange.
  if (typeof o.targetUri === "string") {
    const range = (o.targetSelectionRange ?? o.targetRange) as
      | { start?: { line?: unknown } }
      | undefined;
    const line = range?.start?.line;
    return typeof line === "number" ? { uri: o.targetUri, line } : null;
  }

  // Location: uri + range.
  if (typeof o.uri === "string") {
    const range = o.range as { start?: { line?: unknown } } | undefined;
    const line = range?.start?.line;
    if (typeof line === "number") return { uri: o.uri, line };
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/app/src/main/lsp/definition.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/lsp/definition.ts packages/app/src/main/lsp/definition.test.ts
git commit -m "feat(lsp): pure firstDefinitionLocation normalizer for go-to-definition"
```

---

## Task 2: `LspDefinition` type + `lspDefinition` client method

**Files:**
- Modify: `packages/app/src/shared/ipc.ts` (add type after `LspHover`, ~line 66)
- Modify: `packages/app/src/main/lsp/client.ts` (import normalizer + add method)

- [ ] **Step 1: Add the shared type**

In `packages/app/src/shared/ipc.ts`, immediately after the `LspHover` interface (which ends `}` near line 66), add:

```ts
export interface LspDefinition {
  relPath: string;
  line: number; // 1-indexed, ready for revealLine
}
```

- [ ] **Step 2: Import the normalizer + the type in client.ts**

In `packages/app/src/main/lsp/client.ts`, change the shared-types import:

```ts
import type { LspCompletionItem, LspDefinition, LspDiagnostic } from "../../shared/ipc";
```

and add a new import for the normalizer (next to the other top imports):

```ts
import { firstDefinitionLocation } from "./definition";
```

- [ ] **Step 3: Add the `lspDefinition` method**

In `packages/app/src/main/lsp/client.ts`, add this exported function right after `lspCompletion` (before `disposeServer`). It mirrors `lspHover`: `ensure` + `await ready`, send the request, normalize, map the uri to a root-relative path, convert the 0-indexed line to 1-indexed, never throw.

```ts
export async function lspDefinition(
  root: string,
  relPath: string,
  line: number,
  character: number,
): Promise<LspDefinition | null> {
  const s = ensure(root);
  await s.ready;
  try {
    const r = (await s.conn.sendRequest("textDocument/definition", {
      textDocument: { uri: await uriOf(root, relPath) },
      position: { line, character },
    })) as unknown;
    const loc = firstDefinitionLocation(r);
    if (!loc) return null;
    const rel = uriToRel(root, loc.uri);
    if (rel === null) return null; // definition is outside the workspace root
    return { relPath: rel, line: loc.line + 1 }; // 0-indexed LSP -> 1-indexed
  } catch (err) {
    console.error("[lsp] definition failed", err);
    return null;
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors). `firstDefinitionLocation`, `uriOf`, `uriToRel`, and `LspDefinition` all resolve.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shared/ipc.ts packages/app/src/main/lsp/client.ts
git commit -m "feat(lsp): lspDefinition client method + LspDefinition shared type"
```

---

## Task 3: `lsp:definition` IPC (preload wire + main handler + AirlockApi)

**Files:**
- Modify: `packages/app/src/shared/ipc.ts` (add to `AirlockApi`, after `lspCompletion`, ~line 483)
- Modify: `packages/app/src/preload/index.ts` (add wire after `lspCompletion`, ~line 144)
- Modify: `packages/app/src/main/ipc.ts` (import `lspDefinition`; add handler after `lsp:completion`, ~line 461)

- [ ] **Step 1: Declare the method on `AirlockApi`**

In `packages/app/src/shared/ipc.ts`, immediately after the `lspCompletion(...)` method declaration (ends `): Promise<LspCompletionItem[]>;` near line 483), add:

```ts
  lspDefinition(
    root: string,
    relPath: string,
    line: number,
    character: number,
  ): Promise<LspDefinition | null>;
```

- [ ] **Step 2: Add the preload wire**

In `packages/app/src/preload/index.ts`, immediately after the `lspCompletion:` wire (lines ~143-144), add:

```ts
  lspDefinition: (root, relPath, line, character) =>
    ipcRenderer.invoke("lsp:definition", root, relPath, line, character),
```

- [ ] **Step 3: Add the main handler**

In `packages/app/src/main/ipc.ts`, add `lspDefinition` to the existing import from `"./lsp/client"` (the one that already imports `lspHover, lspCompletion`). Then, immediately after the `ipcMain.handle("lsp:completion", ...)` block (ends near line 461), add:

```ts
  ipcMain.handle(
    "lsp:definition",
    (e, root: unknown, relPath: unknown, line: unknown, character: unknown) => {
      if (
        typeof relPath !== "string" ||
        typeof line !== "number" ||
        typeof character !== "number"
      )
        throw new Error("Invalid payload");
      return lspDefinition(resolveRoot(e, root), relPath, line, character);
    },
  );
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS. The preload object now satisfies `AirlockApi` (no "missing property lspDefinition" error), and the handler's `lspDefinition` import resolves.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shared/ipc.ts packages/app/src/preload/index.ts packages/app/src/main/ipc.ts
git commit -m "feat(lsp): lsp:definition IPC (preload wire + main handler + AirlockApi)"
```

---

## Task 4: EditorPane Cmd-click + `goToDefinition` flow (implement on Opus)

**Files:**
- Modify: `packages/app/src/renderer/src/components/EditorPane.tsx`
- Test: `packages/app/src/renderer/src/components/goToDefinition.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/app/src/renderer/src/components/goToDefinition.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// Mock the opener so we assert the navigation call without touching the store.
vi.mock("../lib/editorFiles", () => ({
  openEditorFile: vi.fn(),
  closeEditorFile: vi.fn(),
}));
import { openEditorFile } from "../lib/editorFiles";
import { goToDefinition } from "./EditorPane";

const openMock = openEditorFile as unknown as ReturnType<typeof vi.fn>;

describe("goToDefinition", () => {
  it("syncs the document BEFORE asking the server, then opens the target", async () => {
    openMock.mockClear();
    const order: string[] = [];
    const lspDefinition = vi.fn(async () => {
      order.push("definition");
      return { relPath: "src/x.ts", line: 12 };
    });
    (window as unknown as { airlock: { lspDefinition: typeof lspDefinition } }).airlock = {
      lspDefinition,
    };
    const sync = vi.fn(async () => {
      order.push("sync");
    });
    await goToDefinition("root", "a.ts", "tab1", sync, "const x = 1;\nx", 13);
    expect(order).toEqual(["sync", "definition"]);
    expect(lspDefinition).toHaveBeenCalledWith("root", "a.ts", 1, 1);
    expect(openMock).toHaveBeenCalledWith("tab1", "src/x.ts", 12);
  });

  it("opens nothing when the server returns no definition", async () => {
    openMock.mockClear();
    const lspDefinition = vi.fn(async () => null);
    (window as unknown as { airlock: { lspDefinition: typeof lspDefinition } }).airlock = {
      lspDefinition,
    };
    await goToDefinition("root", "a.ts", "tab1", vi.fn(async () => {}), "x", 1);
    expect(openMock).not.toHaveBeenCalled();
  });
});
```

Note on the expected position `(1, 1)`: the doc is `"const x = 1;\nx"`; offset 13 is just after the `x` on line 1, so `positionAt` returns `{ line: 1, character: 1 }`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/app/src/renderer/src/components/goToDefinition.test.tsx`
Expected: FAIL -- `goToDefinition` is not exported from `./EditorPane`.

- [ ] **Step 3: Add the import + exported `goToDefinition` in EditorPane.tsx**

Add the opener import near the other lib imports at the top of `EditorPane.tsx`:

```ts
import { openEditorFile } from "../lib/editorFiles";
```

Add this exported module-level function (place it next to `makeLspHover`, before the `EditorPane` component):

```ts
// Jump to a symbol's definition. Flushes the document to the server first (like
// completion/hover), asks for textDocument/definition, and reuses openEditorFile
// to open/switch + reveal the target. A null result (no def, non-symbol, or a
// target outside the workspace) is a silent no-op.
export async function goToDefinition(
  root: string,
  relPath: string,
  tabId: string,
  sync: () => Promise<void>,
  docText: string,
  pos: number,
): Promise<void> {
  try {
    await sync();
    const { line, character } = positionAt(docText, pos);
    const def = await window.airlock.lspDefinition(root, relPath, line, character);
    if (def) await openEditorFile(tabId, def.relPath, def.line);
  } catch (err) {
    console.error("[lsp] go-to-definition failed", err);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/app/src/renderer/src/components/goToDefinition.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the Cmd-click handler into the editor extensions**

In `EditorPane.tsx`, the `lspLang` branch of the extensions array currently is:

```ts
          ...(lspLang
            ? [
                autocompletion({
                  override: [
                    makeLspCompletionSource(root, relPath, syncLspNow),
                  ],
                }),
                makeLspHover(root, relPath, syncLspNow),
              ]
            : []),
```

Add the Cmd-click handler as a third extension in that array:

```ts
          ...(lspLang
            ? [
                autocompletion({
                  override: [
                    makeLspCompletionSource(root, relPath, syncLspNow),
                  ],
                }),
                makeLspHover(root, relPath, syncLspNow),
                EditorView.domEventHandlers({
                  mousedown(event, view) {
                    if (!event.metaKey) return false;
                    const pos = view.posAtCoords({
                      x: event.clientX,
                      y: event.clientY,
                    });
                    if (pos == null) return false;
                    event.preventDefault(); // suppress cursor/selection on this click
                    void goToDefinition(
                      root,
                      relPath,
                      tabId,
                      syncLspNow,
                      view.state.doc.toString(),
                      pos,
                    );
                    return true;
                  },
                }),
              ]
            : []),
```

(`EditorView` is already imported; `tabId`, `root`, `relPath`, `syncLspNow` are already in scope in the effect.)

- [ ] **Step 6: Verify the whole suite + typecheck + lint**

Run: `npm run typecheck && npx vitest run && npx biome check .`
Expected: typecheck clean; all tests pass (prior count + the new files); biome clean. If biome reports formatting, run `npx biome check --write .` and re-run.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/renderer/src/components/EditorPane.tsx packages/app/src/renderer/src/components/goToDefinition.test.tsx
git commit -m "feat(lsp): Cmd-click go-to-definition in EditorPane"
```

---

## Final verification (controller)

- [ ] **Whole-feature gate:** `npm run typecheck` (clean), `npx vitest run` (all pass), `npx biome check .` (clean).

- [ ] **Headless server probe** (confidence that the real server answers `textDocument/definition`, like slices 1-2). Create `def-probe.mjs` at the repo root, run `node def-probe.mjs`, confirm it reports a definition line, then delete it:

```js
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node";

const require = createRequire(import.meta.url);
const dir = mkdtempSync(path.join(tmpdir(), "def-"));
writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }));
const file = path.join(dir, "demo.ts");
// `greeting` is declared on line 0; the usage is on line 1. Definition of the
// usage should point back to line 0.
const text = 'const greeting = "x";\ngreeting;\n';
writeFileSync(file, text);
const cli = require.resolve("typescript-language-server/lib/cli.mjs");
const tsserver = require.resolve("typescript/lib/tsserver.js");
const proc = spawn(process.execPath, [cli, "--stdio"], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
const conn = createMessageConnection(new StreamMessageReader(proc.stdout), new StreamMessageWriter(proc.stdin));
conn.listen();
const uri = pathToFileURL(file).toString();
await conn.sendRequest("initialize", {
  processId: process.pid, rootUri: pathToFileURL(dir).toString(),
  initializationOptions: { tsserver: { path: tsserver } },
  capabilities: { textDocument: { definition: {}, synchronization: {} } },
});
conn.sendNotification("initialized", {});
conn.sendNotification("textDocument/didOpen", { textDocument: { uri, languageId: "typescript", version: 1, text } });
await new Promise((r) => setTimeout(r, 1500));
const r = await conn.sendRequest("textDocument/definition", { textDocument: { uri }, position: { line: 1, character: 2 } });
const first = Array.isArray(r) ? r[0] : r;
const line = first?.range?.start?.line ?? first?.targetSelectionRange?.start?.line ?? first?.targetRange?.start?.line;
console.log("definition line:", line, JSON.stringify(first));
console.log(line === 0 ? "PASS: usage -> declaration on line 0" : "FAIL");
proc.kill();
process.exit(0);
```

- [ ] **Package + manual gate:** `npm run package`, then in the packaged app open a TS/JS file and **Cmd-click** a symbol whose definition is elsewhere in your workspace -> the editor opens/switches to that file and selects the definition line. Cmd-click a symbol defined in the same file -> it scrolls/selects in place. (A symbol whose definition is in `node_modules`/`lib.d.ts` does nothing -- expected v1 scope.)

- [ ] **Finish:** on the user's gate approval, use superpowers:finishing-a-development-branch to merge `feat/lsp-go-to-definition` -> `main` (local; push only on request).

---

## Self-Review

- **Spec coverage:** trigger=Cmd-click only (Task 4 Step 5); request/response + flush-first (Task 4 `goToDefinition` awaits `sync`); reuse `openEditorFile` (Task 4); first result (Task 1); within-workspace only (Task 2 returns null when `uriToRel` is null); TS/JS only (handler is inside the `lspLang ?` branch); IPC trio (Task 3); normalizer + flow tests (Tasks 1, 4); manual gate + probe (Final). All covered.
- **Type consistency:** `LspDefinition { relPath; line }` defined in Task 2 Step 1, returned by `lspDefinition` (Task 2), declared on `AirlockApi` (Task 3), consumed in `goToDefinition` as `def.relPath`/`def.line` (Task 4). `firstDefinitionLocation` returns `{ uri; line }` (0-indexed) in Task 1 and is consumed in Task 2 with `loc.line + 1`. Consistent.
- **Placeholders:** none -- every code step is complete.
- **Line indexing:** server 0-indexed -> `+1` in `lspDefinition` -> 1-indexed `LspDefinition.line` -> `openEditorFile`/`revealLine` -> reveal effect's `doc.line(lineNo)`. Matches how search reveals.
