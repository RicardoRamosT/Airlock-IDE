// @vitest-environment jsdom
// Regression tests for the "member completion shows no menu" bug. Root cause:
// completion queried the language server before the just-typed text was synced
// (didChange is debounced), so a member query (`foo.`) hit a STALE server, which
// returned top-level completions; CodeMirror then filtered those out against the
// typed prefix, leaving an empty menu. Fix: the completion source calls `sync`
// (a flushing didChange) BEFORE the request. These lock in both the fix and the
// CodeMirror wiring it relies on.
import {
  autocompletion,
  type CompletionContext,
  type CompletionSource,
  completionStatus,
  currentCompletions,
  startCompletion,
} from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { describe, expect, it, vi } from "vitest";
import { makeLspCompletionSource } from "./EditorPane";

function makeView(doc: string, extra: Extension[]) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [basicSetup, javascript({ jsx: true, typescript: true }), ...extra],
    }),
    parent,
  });
}

async function settle(view: EditorView, ms = 300) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    await new Promise((r) => setTimeout(r, 10));
    if (completionStatus(view.state) === "active") return;
  }
}

// A CompletionContext just past `"hello".to` (the cursor is after `to`).
function ctxAfterDotTo(): CompletionContext {
  return {
    pos: 10,
    explicit: false,
    matchBefore: () => ({ from: 8, to: 10, text: "to" }),
    state: { doc: { toString: () => '"hello".to' } },
  } as unknown as CompletionContext;
}

describe("CodeMirror completion wiring", () => {
  it("uses our override source after a dot (built-in does NOT shadow it)", async () => {
    const source: CompletionSource = vi.fn(async (ctx) => {
      const word = ctx.matchBefore(/[\w$]*/);
      if (!word) return null;
      return { from: word.from, options: [{ label: "toUpperCase" }], validFor: /[\w$]*/ };
    });
    const view = makeView('"hello".to', [autocompletion({ override: [source] })]);
    startCompletion(view);
    await settle(view);
    expect(source).toHaveBeenCalled();
    expect(currentCompletions(view.state).map((c) => c.label)).toContain("toUpperCase");
  });

  it("renders NO menu when items don't match the typed prefix (the stale-server symptom)", async () => {
    const source: CompletionSource = async (ctx) => {
      const word = ctx.matchBefore(/[\w$]*/);
      if (!word) return null;
      return {
        from: word.from,
        options: ["abstract", "boolean", "string", "switch", "symbol"].map((label) => ({ label })),
        validFor: /[\w$]*/,
      };
    };
    const view = makeView('"hello".to', [autocompletion({ override: [source] })]);
    startCompletion(view);
    await settle(view, 250);
    expect(currentCompletions(view.state).map((c) => c.label)).toEqual([]);
  });

  it("renders the menu when items match (real member completions)", async () => {
    const source: CompletionSource = async (ctx) => {
      const word = ctx.matchBefore(/[\w$]*/);
      if (!word) return null;
      return {
        from: word.from,
        options: ["toUpperCase", "toLowerCase", "toString"].map((label) => ({ label })),
        validFor: /[\w$]*/,
      };
    };
    const view = makeView('"hello".to', [autocompletion({ override: [source] })]);
    startCompletion(view);
    await settle(view);
    expect(currentCompletions(view.state).map((c) => c.label)).toContain("toUpperCase");
  });
});

describe("makeLspCompletionSource", () => {
  it("syncs the document to the server BEFORE requesting completions", async () => {
    const order: string[] = [];
    const lspCompletion = vi.fn(async () => {
      order.push("completion");
      return [{ label: "toUpperCase", kind: 2 }];
    });
    (window as unknown as { airlock: { lspCompletion: typeof lspCompletion } }).airlock = {
      lspCompletion,
    };
    const sync = vi.fn(async () => {
      order.push("sync");
    });
    const src = makeLspCompletionSource("root", "a.ts", sync);
    const result = await src(ctxAfterDotTo());
    expect(order).toEqual(["sync", "completion"]); // flush first, then query
    expect(lspCompletion).toHaveBeenCalledWith("root", "a.ts", 0, 10);
    const labels = result && "options" in result ? result.options.map((o) => o.label) : [];
    expect(labels).toContain("toUpperCase");
  });

  it("returns null without calling the server when there is no word prefix", async () => {
    const sync = vi.fn(async () => {});
    const lspCompletion = vi.fn(async () => []);
    (window as unknown as { airlock: { lspCompletion: typeof lspCompletion } }).airlock = {
      lspCompletion,
    };
    const src = makeLspCompletionSource("root", "a.ts", sync);
    const ctx = {
      pos: 0,
      explicit: false,
      matchBefore: () => null,
      state: { doc: { toString: () => "" } },
    } as unknown as CompletionContext;
    expect(await src(ctx)).toBeNull();
    expect(sync).not.toHaveBeenCalled();
    expect(lspCompletion).not.toHaveBeenCalled();
  });

  it("returns null when the server has no completions", async () => {
    const sync = vi.fn(async () => {});
    const lspCompletion = vi.fn(async () => []);
    (window as unknown as { airlock: { lspCompletion: typeof lspCompletion } }).airlock = {
      lspCompletion,
    };
    const src = makeLspCompletionSource("root", "a.ts", sync);
    expect(await src(ctxAfterDotTo())).toBeNull();
    expect(sync).toHaveBeenCalled();
  });
});
