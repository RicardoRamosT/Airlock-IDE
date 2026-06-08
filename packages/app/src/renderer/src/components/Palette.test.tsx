// @vitest-environment jsdom
//
// The command/quick-open palette: files mode (Cmd+P) opens a fuzzy file list;
// a leading ">" flips to commands mode (Cmd+Shift+P); Enter runs the selection,
// Escape closes.

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { Palette } from "./Palette";

// Spy openEditorFile so a file pick is observable without the full open flow.
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
      listAllFiles: () =>
        Promise.resolve({ files: ["a.ts", "src/b.ts"], truncated: false }),
    },
    {
      get: (t, p) =>
        p in t
          ? (t as Record<string, unknown>)[p as string]
          : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
  useApp.setState(initialState, true);
  // Seed the active tab's root so files mode has a project.
  const tabId = useApp.getState().activeTabId;
  const cur = useApp.getState().tabState[tabId];
  if (cur)
    useApp.setState({
      tabState: {
        ...useApp.getState().tabState,
        [tabId]: { ...cur, root: ROOT },
      },
    });
});
afterEach(() => cleanup());

it("files mode: type then Enter opens the matched file and closes", async () => {
  useApp.getState().openPalette("files");
  const { container, getByPlaceholderText } = render(<Palette />);
  const input = getByPlaceholderText(/go to file/i) as HTMLInputElement;
  await waitFor(() =>
    expect(container.querySelectorAll(".palette-row").length).toBeGreaterThan(
      0,
    ),
  );
  fireEvent.change(input, { target: { value: "b.ts" } });
  await waitFor(() => expect(container.textContent).toContain("src/b.ts"));
  fireEvent.keyDown(input, { key: "Enter" });
  expect(openEditorFile).toHaveBeenCalledWith(
    useApp.getState().activeTabId,
    "src/b.ts",
  );
  expect(useApp.getState().palette).toBeNull();
});

it("'>' switches to commands mode and runs a command", () => {
  useApp.getState().openPalette("files");
  const { getByPlaceholderText } = render(<Palette />);
  const input = getByPlaceholderText(/go to file/i) as HTMLInputElement;
  fireEvent.change(input, { target: { value: ">new tab" } });
  const before = useApp.getState().tabs.length;
  fireEvent.keyDown(input, { key: "Enter" });
  expect(useApp.getState().tabs.length).toBe(before + 1);
  expect(useApp.getState().palette).toBeNull();
});

it("Escape closes", () => {
  useApp.getState().openPalette("commands");
  const { getByPlaceholderText } = render(<Palette />);
  fireEvent.keyDown(getByPlaceholderText(/run a command/i), { key: "Escape" });
  expect(useApp.getState().palette).toBeNull();
});
