// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { ReferencesPanel } from "./ReferencesPanel";

const openEditorFile = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("../lib/editorFiles", () => ({
  openEditorFile: (...a: unknown[]) => openEditorFile(...a),
}));

const initial = useApp.getState();
beforeEach(() => {
  useApp.setState(initial, true);
  openEditorFile.mockClear();
});
afterEach(cleanup);

it("renders 'No references found' when results are empty", () => {
  useApp.setState({ references: { symbol: "foo", results: [] } });
  render(<ReferencesPanel />);
  expect(screen.getByText("No references found")).toBeTruthy();
});

it("renders a file group with hit rows and the symbol in the header", () => {
  useApp.setState({
    references: {
      symbol: "foo",
      results: [
        {
          relPath: "src/a.ts",
          hits: [
            { line: 3, character: 2, snippet: "const foo = 1" },
            { line: 9, character: 6, snippet: "return foo()" },
          ],
        },
      ],
    },
  });
  render(<ReferencesPanel />);
  expect(screen.getByText("foo")).toBeTruthy(); // header – exact match targets <strong>foo</strong> (regex /foo/ matches snippets too)
  expect(screen.getByText("src/a.ts")).toBeTruthy();
  expect(screen.getByText("const foo = 1")).toBeTruthy();
  expect(screen.getByText("return foo()")).toBeTruthy();
});

it("jumps to a hit (relPath, 1-indexed line) and closes on click", () => {
  useApp.setState({
    activeTabId: "tab1",
    tabState: { tab1: { root: "/repo" } } as never,
    references: {
      symbol: "foo",
      results: [
        {
          relPath: "src/a.ts",
          hits: [{ line: 3, character: 2, snippet: "x" }],
        },
      ],
    },
  });
  render(<ReferencesPanel />);
  fireEvent.click(screen.getByText("x"));
  expect(openEditorFile).toHaveBeenCalledWith("tab1", "src/a.ts", 3);
  expect(useApp.getState().references).toBeNull();
});
