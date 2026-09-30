// @vitest-environment jsdom
// ESLint's lifecycle inside the real EditorPane: the trust gate, the merge with
// TypeScript's marks, stale-result discard, and the version-checked Fix.
import { forEachDiagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  EslintLintResult,
  EslintStatus,
  FileContent,
} from "../../../shared/ipc";
import { useApp } from "../store";
import { EditorPane } from "./EditorPane";

const initial = useApp.getState();
const file = (content: string): FileContent => ({
  content,
  truncated: false,
  binary: false,
  size: content.length,
  mtimeMs: 1,
});

let status: EslintStatus;
let eslintLint: ReturnType<typeof vi.fn>;
let eslintSetTrust: ReturnType<typeof vi.fn>;
let lspListeners: ((e: unknown) => void)[];

beforeEach(() => {
  status = { state: "untrusted", unit: "" };
  lspListeners = [];
  eslintLint = vi.fn(
    async (
      _r: string,
      _p: string,
      version: number,
    ): Promise<EslintLintResult> => ({
      version,
      messages: [],
    }),
  );
  eslintSetTrust = vi.fn(async (_r: string, _u: string, on: boolean) => {
    status = { state: on ? "trusted" : "untrusted", unit: "" };
  });
  const api: Record<string, unknown> = {
    eslintStatus: vi.fn(async () => status),
    eslintLint,
    eslintSetTrust,
    onLspDiagnostics: (cb: (e: unknown) => void) => {
      lspListeners.push(cb);
      return () => {};
    },
    lspDocumentSymbol: async () => [],
  };
  window.airlock = new Proxy(api, {
    get: (t, k) => (k in t ? t[k as string] : () => Promise.resolve()),
    // biome-ignore lint/suspicious/noExplicitAny: preload bridge test double
  }) as any;
  useApp.setState(initial, true);
});
afterEach(cleanup);

function mount(content: string) {
  const r = render(
    <EditorPane
      tabId="t"
      root="/p"
      relPath="src/a.ts"
      file={file(content)}
      theme="dark"
    />,
  );
  const dom = r.container.querySelector(".cm-editor") as HTMLElement;
  const view = EditorView.findFromDOM(dom);
  if (!view) throw new Error("no editor view");
  return { ...r, view };
}

function marks(view: EditorView): string[] {
  const out: string[] = [];
  forEachDiagnostic(view.state, (d) =>
    out.push(`${d.source ?? "ts"}:${d.message}`),
  );
  return out;
}

const noVar = (version: number): EslintLintResult => ({
  version,
  messages: [
    {
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 4,
      severity: 2,
      ruleId: "no-var",
      message: "Unexpected var",
      fix: { range: [0, 3], text: "let" },
    },
  ],
});

it("asks first, and runs nothing until Enable is clicked", async () => {
  mount("var x = 1;\n");
  await screen.findByRole("button", { name: "Enable ESLint here" });
  expect(eslintLint).not.toHaveBeenCalled();
  eslintLint.mockImplementation(async (_r: string, _p: string, v: number) =>
    noVar(v),
  );
  fireEvent.click(screen.getByRole("button", { name: "Enable ESLint here" }));
  await waitFor(() => expect(eslintLint).toHaveBeenCalled());
  expect(eslintSetTrust).toHaveBeenCalledWith("/p", "", true);
  expect(
    screen.queryByRole("button", { name: "Enable ESLint here" }),
  ).toBeNull();
});

it("shows ESLint's marks beside TypeScript's; neither erases the other", async () => {
  status = { state: "trusted", unit: "" };
  eslintLint.mockImplementation(async (_r: string, _p: string, v: number) =>
    noVar(v),
  );
  const { view } = mount("var x = 1;\n");
  await waitFor(() =>
    expect(marks(view)).toContain("eslint(no-var):Unexpected var"),
  );
  act(() => {
    for (const l of lspListeners)
      l({
        root: "/p",
        relPath: "src/a.ts",
        diagnostics: [
          {
            range: {
              start: { line: 0, character: 4 },
              end: { line: 0, character: 5 },
            },
            severity: 1,
            message: "TS2322",
          },
        ],
      });
  });
  expect(marks(view).sort()).toEqual([
    "eslint(no-var):Unexpected var",
    "ts:TS2322",
  ]);
  expect(await screen.findByRole("button", { name: "ESLint 1" })).toBeTruthy();
});

it("discards a result that arrives after newer typing", async () => {
  status = { state: "trusted", unit: "" };
  let release: (r: EslintLintResult) => void = () => {};
  eslintLint.mockImplementationOnce(
    (_r: string, _p: string, v: number) =>
      new Promise<EslintLintResult>((res) => {
        release = () => res(noVar(v));
      }),
  );
  const { view } = mount("var x = 1;\n");
  await waitFor(() => expect(eslintLint).toHaveBeenCalledTimes(1));
  // The user types; a newer lint goes out (version 2) and comes back clean.
  act(() => view.dispatch({ changes: { from: 0, insert: "// hi\n" } }));
  await waitFor(() => expect(eslintLint).toHaveBeenCalledTimes(2), {
    timeout: 2000,
  });
  await act(async () => release(noVar(1))); // the stale v1 result lands last
  expect(marks(view)).toEqual([]);
});

it("Fix applies ESLint's edit to the buffer it was computed from", async () => {
  status = { state: "trusted", unit: "" };
  eslintLint.mockImplementation(async (_r: string, _p: string, v: number) =>
    noVar(v),
  );
  const { view } = mount("var x = 1;\n");
  await waitFor(() => expect(marks(view)).toHaveLength(1));
  let fix: (() => void) | undefined;
  forEachDiagnostic(view.state, (d) => {
    const a = d.actions?.[0];
    if (a) fix = () => a.apply(view, d.from, d.to);
  });
  act(() => fix?.());
  expect(view.state.doc.toString()).toBe("let x = 1;\n");
});

it("a stale Fix re-lints instead of editing shifted text", async () => {
  status = { state: "trusted", unit: "" };
  eslintLint.mockImplementation(async (_r: string, _p: string, v: number) =>
    noVar(v),
  );
  const { view } = mount("var x = 1;\n");
  await waitFor(() => expect(marks(view)).toHaveLength(1));
  let fix: (() => void) | undefined;
  forEachDiagnostic(view.state, (d) => {
    const a = d.actions?.[0];
    if (a) fix = () => a.apply(view, d.from, d.to);
  });
  const calls = eslintLint.mock.calls.length;
  act(() => view.dispatch({ changes: { from: 0, insert: "  " } })); // buffer moves on
  act(() => fix?.());
  expect(view.state.doc.toString()).toBe("  var x = 1;\n"); // untouched
  expect(eslintLint.mock.calls.length).toBeGreaterThan(calls); // re-linted
});

it("Disable removes ESLint's marks at once", async () => {
  status = { state: "trusted", unit: "" };
  eslintLint.mockImplementation(async (_r: string, _p: string, v: number) =>
    noVar(v),
  );
  const { view } = mount("var x = 1;\n");
  await waitFor(() => expect(marks(view)).toHaveLength(1));
  fireEvent.click(await screen.findByRole("button", { name: "ESLint 1" }));
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Disable ESLint for this folder" }),
  );
  await waitFor(() => expect(marks(view)).toEqual([]));
  expect(eslintSetTrust).toHaveBeenCalledWith("/p", "", false);
});
