# LSP Slice 2 -- Hover + Completions -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hover tooltips (type/doc) and real typed autocomplete for TS/JS, on the slice-1 LSP foundation.

**Architecture:** Two request/response methods on the existing per-root client (`lspHover`, `lspCompletion`), exposed via IPC; the renderer wires CodeMirror's `autocompletion` (an LSP completion source) and `hoverTooltip`, using pure helpers (`positionAt`, `toCmCompletions`).

**Tech Stack:** Electron, React 19, CodeMirror, TypeScript (strict), vitest, biome. New dep: `@codemirror/autocomplete` (already transitive).

**Spec:** `docs/superpowers/specs/2026-06-08-lsp-hover-completions-design.md`

---

## Conventions

- **ASCII-only** in `packages/app/src/main/**`, `packages/app/src/preload/**`,
  `packages/app/src/shared/ipc.ts` (CJS bundling; use `--`). Renderer exempt.
- Commands (repo root): `npx vitest run <path>`; `npm run typecheck`; lint
  `npx biome check --write <paths>` then `npx biome check <paths>`.
- Branch: `feat/lsp-hover-completions` (already created). Do NOT push.
- Execution: Tasks 1-3 subagents; Task 4 (EditorPane CM wiring) ON OPUS.

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `packages/app/package.json` | add `@codemirror/autocomplete` | 1 |
| `packages/app/src/renderer/src/lib/lspPositions.ts` (new) | offset -> LSP position | 1 |
| `packages/app/src/renderer/src/lib/lspCompletions.ts` (new) | LSP item -> CM completion | 1 |
| `packages/app/src/main/lsp/client.ts` | `lspHover` + `lspCompletion` request methods | 2 |
| `packages/app/src/shared/ipc.ts` | `LspHover`/`LspCompletionItem` + API | 3 |
| `packages/app/src/preload/index.ts` | wire `lsp:hover`/`lsp:completion` | 3 |
| `packages/app/src/main/ipc.ts` | two handlers | 3 |
| `packages/app/src/renderer/src/components/EditorPane.tsx` | autocompletion + hoverTooltip | 4 |
| `packages/app/src/renderer/src/theme.css` | `.cm-lsp-hover` | 4 |

---

## Task 1: dep + pure helpers

**Files:** `package.json` (install); `lib/lspPositions.ts` + `.test.ts`; `lib/lspCompletions.ts` + `.test.ts`.

- [ ] **Step 1: Install the dep.**

```bash
npm install @codemirror/autocomplete -w @airlock/app
```

- [ ] **Step 2: Write the failing tests.**

`packages/app/src/renderer/src/lib/lspPositions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { positionAt } from "./lspPositions";

describe("positionAt", () => {
  const text = "ab\ncde\nf";
  it("maps offsets to line/character", () => {
    expect(positionAt(text, 0)).toEqual({ line: 0, character: 0 });
    expect(positionAt(text, 2)).toEqual({ line: 0, character: 2 });
    expect(positionAt(text, 3)).toEqual({ line: 1, character: 0 });
    expect(positionAt(text, 5)).toEqual({ line: 1, character: 2 });
  });
  it("clamps out-of-range offsets", () => {
    expect(positionAt(text, 999)).toEqual({ line: 2, character: 1 });
    expect(positionAt(text, -5)).toEqual({ line: 0, character: 0 });
  });
});
```

`packages/app/src/renderer/src/lib/lspCompletions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toCmCompletions } from "./lspCompletions";

describe("toCmCompletions", () => {
  it("maps kind to CM type and uses insertText for apply", () => {
    const out = toCmCompletions([
      { label: "map", kind: 2, detail: "(method) map(): void", documentation: "doc", insertText: "map" },
      { label: "length", kind: 10 },
    ]);
    expect(out[0]).toEqual({
      label: "map",
      type: "method",
      detail: "(method) map(): void",
      info: "doc",
      apply: "map",
    });
    expect(out[1]).toEqual({ label: "length", type: "property", detail: undefined, info: undefined, apply: "length" });
  });
  it("handles empty + unknown kind", () => {
    expect(toCmCompletions([])).toEqual([]);
    expect(toCmCompletions([{ label: "x", kind: 999 }])[0]?.type).toBe("variable");
  });
});
```

Run both -> FAIL (modules missing).

- [ ] **Step 3: Implement `lspPositions.ts`.**

```ts
// Inverse of slice 1's offset mapping: a character offset in `text` -> the LSP
// { line, character } position. Clamped to the document.
export function positionAt(
  text: string,
  offset: number,
): { line: number; character: number } {
  const o = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < o; i++) {
    if (text[i] === "\n") {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, character: o - lineStart };
}
```

- [ ] **Step 4: Implement `lspCompletions.ts`.**

```ts
import type { Completion } from "@codemirror/autocomplete";
import type { LspCompletionItem } from "../../../shared/ipc";

// LSP CompletionItemKind -> CodeMirror completion `type` (drives the icon).
const KIND: Record<number, NonNullable<Completion["type"]>> = {
  2: "method",
  3: "function",
  4: "function",
  5: "property",
  6: "variable",
  7: "class",
  8: "interface",
  9: "namespace",
  10: "property",
  13: "enum",
  14: "keyword",
  21: "constant",
};

export function toCmCompletions(items: LspCompletionItem[]): Completion[] {
  return items.map((it) => ({
    label: it.label,
    type: it.kind !== undefined ? (KIND[it.kind] ?? "variable") : undefined,
    detail: it.detail,
    info: it.documentation,
    apply: it.insertText ?? it.label,
  }));
}
```

(Note: `LspCompletionItem` is added to `shared/ipc.ts` in Task 3. Add that interface NOW as the first step of this task so it typechecks -- see Task 3 Step 1 for the exact shape; Task 3 keeps it.)

- [ ] **Step 5: Run tests + typecheck + lint + commit.**

Run the two test files -> PASS; `npm run typecheck` -> clean.
```bash
npx biome check --write packages/app/src/renderer/src/lib/lspPositions.ts packages/app/src/renderer/src/lib/lspPositions.test.ts packages/app/src/renderer/src/lib/lspCompletions.ts packages/app/src/renderer/src/lib/lspCompletions.test.ts packages/app/src/shared/ipc.ts
git add -A
git commit -m "feat(lsp): @codemirror/autocomplete dep + positionAt/toCmCompletions helpers"
```

---

## Task 2: client hover + completion methods

**Files:** Modify `packages/app/src/main/lsp/client.ts`.

The request path against the real server is gated manually (slice-1 style). ASCII-only.

- [ ] **Step 1: Add `LspCompletionItem` to the client's imports.**

Change the existing `import type { LspDiagnostic } from "../../shared/ipc";` to also import `LspCompletionItem`.

- [ ] **Step 2: Add normalization helpers + the two request methods** (after the existing `lspDidClose`):

```ts
function markupToString(contents: unknown): string {
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents))
    return contents.map(markupToString).filter(Boolean).join("\n\n");
  if (contents && typeof contents === "object") {
    const v = (contents as { value?: unknown }).value;
    if (typeof v === "string") return v;
  }
  return "";
}

export async function lspHover(
  root: string,
  relPath: string,
  line: number,
  character: number,
): Promise<{ contents: string } | null> {
  const s = ensure(root);
  await s.ready;
  try {
    const r = await s.conn.sendRequest("textDocument/hover", {
      textDocument: { uri: await uriOf(root, relPath) },
      position: { line, character },
    });
    if (!r || typeof r !== "object") return null;
    const contents = markupToString((r as { contents?: unknown }).contents);
    return contents ? { contents } : null;
  } catch (err) {
    console.error("[lsp] hover failed", err);
    return null;
  }
}

export async function lspCompletion(
  root: string,
  relPath: string,
  line: number,
  character: number,
): Promise<LspCompletionItem[]> {
  const s = ensure(root);
  await s.ready;
  try {
    const r = await s.conn.sendRequest("textDocument/completion", {
      textDocument: { uri: await uriOf(root, relPath) },
      position: { line, character },
    });
    const raw: unknown[] = Array.isArray(r)
      ? r
      : r && typeof r === "object"
        ? ((r as { items?: unknown[] }).items ?? [])
        : [];
    return raw
      .map((x) => x as Record<string, unknown>)
      .map((it) => ({
        label: typeof it.label === "string" ? it.label : "",
        kind: typeof it.kind === "number" ? it.kind : undefined,
        detail: typeof it.detail === "string" ? it.detail : undefined,
        documentation: markupToString(it.documentation) || undefined,
        insertText: typeof it.insertText === "string" ? it.insertText : undefined,
      }))
      .filter((it) => it.label.length > 0);
  } catch (err) {
    console.error("[lsp] completion failed", err);
    return [];
  }
}
```

- [ ] **Step 3: Verify + commit.**

`npm run typecheck` -> clean; confirm ASCII-only; lint the file.
```bash
git add packages/app/src/main/lsp/client.ts
git commit -m "feat(lsp): client hover + completion request methods"
```

---

## Task 3: IPC

**Files:** `shared/ipc.ts`, `preload/index.ts`, `main/ipc.ts`.

- [ ] **Step 1: Types + API (shared/ipc.ts).** Near `LspDiagnostic`:

```ts
export interface LspHover {
  contents: string;
}
export interface LspCompletionItem {
  label: string;
  kind?: number; // LSP CompletionItemKind
  detail?: string;
  documentation?: string;
  insertText?: string;
}
```

In `AirlockApi`:

```ts
  lspHover(
    root: string,
    relPath: string,
    line: number,
    character: number,
  ): Promise<LspHover | null>;
  lspCompletion(
    root: string,
    relPath: string,
    line: number,
    character: number,
  ): Promise<LspCompletionItem[]>;
```

(If Task 1 already added `LspCompletionItem`, keep one copy.)

- [ ] **Step 2: preload.**

```ts
  lspHover: (root, relPath, line, character) =>
    ipcRenderer.invoke("lsp:hover", root, relPath, line, character),
  lspCompletion: (root, relPath, line, character) =>
    ipcRenderer.invoke("lsp:completion", root, relPath, line, character),
```

- [ ] **Step 3: main handlers.** Add `lspHover`, `lspCompletion` to the `./lsp/client` import, then after the `lsp:didClose` handler:

```ts
  ipcMain.handle(
    "lsp:hover",
    (e, root: unknown, relPath: unknown, line: unknown, character: unknown) => {
      if (
        typeof relPath !== "string" ||
        typeof line !== "number" ||
        typeof character !== "number"
      )
        throw new Error("Invalid payload");
      return lspHover(resolveRoot(e, root), relPath, line, character);
    },
  );
  ipcMain.handle(
    "lsp:completion",
    (e, root: unknown, relPath: unknown, line: unknown, character: unknown) => {
      if (
        typeof relPath !== "string" ||
        typeof line !== "number" ||
        typeof character !== "number"
      )
        throw new Error("Invalid payload");
      return lspCompletion(resolveRoot(e, root), relPath, line, character);
    },
  );
```

- [ ] **Step 4: Verify + commit.**

`npm run typecheck` -> clean; ASCII-only on the 3 files; lint.
```bash
git add packages/app/src/shared/ipc.ts packages/app/src/preload/index.ts packages/app/src/main/ipc.ts
git commit -m "feat(lsp): lsp:hover + lsp:completion IPC"
```

---

## Task 4: EditorPane wiring (ON OPUS)

**Files:** `components/EditorPane.tsx`, `theme.css`. CM autocomplete/hover wiring is fiddly + not unit-testable; gated manually.

- [ ] **Step 1: Imports (EditorPane.tsx).**

```ts
import {
  autocompletion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { hoverTooltip } from "@codemirror/view"; // add to the existing @codemirror/view import
import type { Extension } from "@codemirror/state";
import { positionAt } from "../lib/lspPositions";
import { toCmCompletions } from "../lib/lspCompletions";
```

- [ ] **Step 2: A module-level extension factory** (above the component):

```ts
// LSP completion + hover for one open file. Sources close over root/relPath
// (stable per editor mount) and call the IPC at the cursor position.
function lspExtensions(root: string, relPath: string): Extension[] {
  const completion: CompletionSource = async (context) => {
    const word = context.matchBefore(/[\w$]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    const { line, character } = positionAt(context.state.doc.toString(), context.pos);
    const items = await window.airlock.lspCompletion(root, relPath, line, character);
    if (items.length === 0) return null;
    return { from: word.from, options: toCmCompletions(items), validFor: /[\w$]*/ };
  };
  const hover = hoverTooltip(async (view, pos) => {
    const { line, character } = positionAt(view.state.doc.toString(), pos);
    const r = await window.airlock.lspHover(root, relPath, line, character);
    if (!r) return null;
    return {
      pos,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-lsp-hover";
        dom.textContent = r.contents;
        return { dom };
      },
    };
  });
  return [autocompletion({ override: [completion] }), hover];
}
```

- [ ] **Step 3: Add the extensions when `lspLang` is set.**

In the editor `extensions` array, after `lintGutter(),` add:

```ts
          ...(lspLang ? lspExtensions(root, relPath) : []),
```

(Verify the LSP completion menu shows server items, not just basicSetup's
word-completion. `override` should make the LSP source authoritative; if both
appear, that is the one thing to resolve here.)

- [ ] **Step 4: CSS (theme.css), appended:**

```css
.cm-lsp-hover {
  max-width: 480px;
  padding: 6px 8px;
  font-size: 12px;
  white-space: pre-wrap;
  color: var(--fg);
  background: var(--bg-panel);
}
```

- [ ] **Step 5: Verify + commit.**

`npm run typecheck` -> clean; `npx vitest run packages/app/src/renderer/src/components/` -> all PASS (no regressions); lint.
```bash
git add packages/app/src/renderer/src/components/EditorPane.tsx packages/app/src/renderer/src/theme.css
git commit -m "feat(lsp): EditorPane hover tooltip + autocomplete via the language server"
```

---

## Final verification

- [ ] `npx vitest run` green; `npm run typecheck` clean; `npx biome check .` clean.
- [ ] `npm run package` -- build for the owner to gate.

## Manual gate checklist (owner)

- Open a `.ts` file: type `[].` then a letter (e.g. `m`) -> a completion menu with
  real array methods (`map`, `filter`, ...) with type icons + details; pick one ->
  it inserts.
- Ctrl-Space mid-identifier -> completions.
- Hover a variable/function -> a tooltip with its type/signature.
- A `.md`/`.json` file shows neither (no LSP).
