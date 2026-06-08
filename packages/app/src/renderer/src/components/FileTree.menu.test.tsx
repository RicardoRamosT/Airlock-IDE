// @vitest-environment jsdom
//
// FileTree context-menu + inline-edit guards:
//  - right-clicking a file row opens a menu with the file ops (Rename/Delete).
//  - choosing Rename, typing a name, and pressing Enter calls moveFile with
//    (root, oldRel, newRel) -- the rename op wired through window.airlock.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DirEntry } from "../../../shared/ipc";
import { ProjectPaneContext } from "../lib/projectPane";
import { useApp } from "../store";
import { FileTree } from "./FileTree";

// Snapshot the pristine store (one blank tab) and restore before each test so
// the shared singleton does not leak state across tests.
const initialState = useApp.getState();

const ROOT = "/workspace";
const ENTRIES: DirEntry[] = [
  { name: "a.ts", type: "file" },
  { name: "src", type: "dir" },
];

let moveFile: ReturnType<typeof vi.fn>;

beforeEach(() => {
  moveFile = vi.fn(() => Promise.resolve(undefined));
  // Default to a no-op resolved Promise for every method; override the two we
  // assert on (listDir feeds the tree; moveFile is the rename spy).
  window.airlock = new Proxy(
    { listDir: () => Promise.resolve(ENTRIES), moveFile },
    {
      get: (target, prop) =>
        prop in target
          ? (target as Record<string, unknown>)[prop as string]
          : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
  useApp.setState(initialState, true);
});

afterEach(() => cleanup());

const get = () => useApp.getState();

// Seed the active tab's project root so FileTree lists ENTRIES, and return the
// tabId to feed ProjectPaneContext.Provider (which useProjectTab reads).
function seedRoot(): string {
  const tabId = get().tabs[0]?.id;
  if (!tabId) throw new Error("no initial tab");
  const cur = get().tabState[tabId];
  if (!cur) throw new Error("no tabState for initial tab");
  useApp.setState({
    tabState: { ...get().tabState, [tabId]: { ...cur, root: ROOT } },
  });
  return tabId;
}

const renderTree = (tabId: string) =>
  render(
    <ProjectPaneContext.Provider value={tabId}>
      <FileTree />
    </ProjectPaneContext.Provider>,
  );

it("right-click on a file row opens a menu with Rename and Delete", async () => {
  const tabId = seedRoot();
  const { findByText, getByText } = renderTree(tabId);

  // listDir resolves async -> wait for the file row to render, then right-click.
  const fileRow = await findByText("a.ts");
  fireEvent.contextMenu(fileRow);

  expect(getByText("Rename")).toBeTruthy();
  expect(getByText("Delete")).toBeTruthy();
});

it("Rename -> type -> Enter calls moveFile(root, 'a.ts', 'b.ts')", async () => {
  const tabId = seedRoot();
  const { findByText, getByText, container } = renderTree(tabId);

  const fileRow = await findByText("a.ts");
  fireEvent.contextMenu(fileRow);
  fireEvent.click(getByText("Rename"));

  // The label is swapped for the inline input; type a new name and submit.
  const input = container.querySelector(
    "input.tree-rename-input",
  ) as HTMLInputElement | null;
  if (!input) throw new Error("rename input not found");
  fireEvent.change(input, { target: { value: "b.ts" } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);

  expect(moveFile).toHaveBeenCalledWith(ROOT, "a.ts", "b.ts");
});
