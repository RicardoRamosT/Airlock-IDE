// @vitest-environment jsdom
//
// FileTree drag-and-drop move:
//  - dragging a file onto a folder row moves it INTO that folder.
//  - dropping ONTO a file targets that file's folder (VS Code-like), so a drop
//    near a file does the intuitive thing instead of going to the root.
//  - dropping back onto the same parent, or a folder onto itself/descendant,
//    is a no-op (the drop handler guards via canDropInto -> no moveFile call).

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
const ROOT_ENTRIES: DirEntry[] = [
  { name: "a.ts", type: "file" },
  { name: "src", type: "dir" },
];
const SRC_ENTRIES: DirEntry[] = [{ name: "b.ts", type: "file" }];

let moveFile: ReturnType<typeof vi.fn>;

beforeEach(() => {
  moveFile = vi.fn(() => Promise.resolve(undefined));
  // listDir feeds the tree (root vs. the expanded "src" folder); moveFile is the
  // spy. Every other method is a no-op resolved Promise.
  window.airlock = new Proxy(
    {
      listDir: (_root: string, rel: string) =>
        Promise.resolve(rel === "src" ? SRC_ENTRIES : ROOT_ENTRIES),
      moveFile,
    },
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

// Seed the active tab's project root so FileTree lists ROOT_ENTRIES, and return
// the tabId to feed ProjectPaneContext (which useProjectTab reads).
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

// jsdom has no DataTransfer; our handlers only touch these four members.
function dt() {
  return {
    setData: vi.fn(),
    getData: vi.fn(() => ""),
    effectAllowed: "",
    dropEffect: "",
  };
}

it("drag a file onto a folder moves it INTO that folder", async () => {
  const tabId = seedRoot();
  const { findByText } = renderTree(tabId);

  // listDir resolves async -> wait for the rows, then drag a.ts onto src.
  const fileRow = await findByText("a.ts");
  const dirRow = await findByText("src");
  const data = dt();

  fireEvent.dragStart(fileRow, { dataTransfer: data });
  fireEvent.dragOver(dirRow, { dataTransfer: data });
  fireEvent.drop(dirRow, { dataTransfer: data });

  expect(moveFile).toHaveBeenCalledWith(ROOT, "a.ts", "src/a.ts");
});

it("dropping ONTO a file targets that file's folder", async () => {
  const tabId = seedRoot();
  const { findByText } = renderTree(tabId);

  // Expand src so its child b.ts renders, then drag b.ts onto the root file
  // a.ts -- the drop should resolve to a.ts's folder (root), moving b.ts up.
  fireEvent.click(await findByText("src"));
  const childRow = await findByText("b.ts");
  const fileRow = await findByText("a.ts");
  const data = dt();

  fireEvent.dragStart(childRow, { dataTransfer: data });
  fireEvent.dragOver(fileRow, { dataTransfer: data });
  fireEvent.drop(fileRow, { dataTransfer: data });

  expect(moveFile).toHaveBeenCalledWith(ROOT, "src/b.ts", "b.ts");
});

it("dropping a folder onto itself is a no-op", async () => {
  const tabId = seedRoot();
  const { findByText } = renderTree(tabId);

  const dirRow = await findByText("src");
  const data = dt();

  fireEvent.dragStart(dirRow, { dataTransfer: data });
  fireEvent.drop(dirRow, { dataTransfer: data });

  expect(moveFile).not.toHaveBeenCalled();
});

it("dropping a file back onto its own parent (root) is a no-op", async () => {
  const tabId = seedRoot();
  const { findByText, container } = renderTree(tabId);

  // a.ts already lives in root; dropping it on the tree background = root.
  const fileRow = await findByText("a.ts");
  const tree = container.querySelector(".tree") as HTMLElement;
  const data = dt();

  fireEvent.dragStart(fileRow, { dataTransfer: data });
  fireEvent.drop(tree, { dataTransfer: data });

  expect(moveFile).not.toHaveBeenCalled();
});
