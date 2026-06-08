// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { SearchPanel } from "./SearchPanel";

const openEditorFile = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("../lib/editorFiles", () => ({
  openEditorFile: (...a: unknown[]) => openEditorFile(...a),
  closeEditorFile: () => Promise.resolve(),
}));

const initialState = useApp.getState();
const ROOT = "/workspace";

beforeEach(() => {
  openEditorFile.mockClear();
  window.airlock = new Proxy(
    {
      searchProject: () =>
        Promise.resolve({
          files: [
            {
              path: "src/b.ts",
              matches: [{ line: 3, col: 0, preview: "hello there" }],
            },
          ],
          truncated: false,
        }),
    },
    {
      get: (t, p) =>
        p in t
          ? (t as Record<string, unknown>)[p as string]
          : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
  useApp.setState(initialState, true);
  const tabId = useApp.getState().activeTabId;
  const cur = useApp.getState().tabState[tabId];
  if (cur)
    useApp.setState({
      tabState: {
        ...useApp.getState().tabState,
        [tabId]: { ...cur, root: ROOT },
      },
      searchOpen: true,
    });
});
afterEach(() => cleanup());

it("Enter searches, click opens the file at the line and closes", async () => {
  const { getByPlaceholderText, container } = render(<SearchPanel />);
  const input = getByPlaceholderText(/search/i) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "hello" } });
  fireEvent.keyDown(input, { key: "Enter" });
  // The preview splits the match across a <b> + text node, so query the row by
  // class rather than by its (element-spanning) text.
  const row = await waitFor(() => {
    const el = container.querySelector(".search-row");
    if (!el) throw new Error("no row yet");
    return el as HTMLElement;
  });
  fireEvent.click(row);
  await waitFor(() =>
    expect(openEditorFile).toHaveBeenCalledWith(
      useApp.getState().activeTabId,
      "src/b.ts",
      3,
    ),
  );
  expect(useApp.getState().searchOpen).toBe(false);
});

it("Escape closes the panel", () => {
  const { getByPlaceholderText } = render(<SearchPanel />);
  fireEvent.keyDown(getByPlaceholderText(/search/i), { key: "Escape" });
  expect(useApp.getState().searchOpen).toBe(false);
});
