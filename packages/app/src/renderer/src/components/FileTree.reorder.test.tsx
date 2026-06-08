// @vitest-environment jsdom
//
// FileTree drag-to-reorder. A drag has two intents decided by the pointer band:
//  - dropping on a sibling row's top/bottom edge reorders within the folder
//    (persists via setFileOrder);
//  - dropping on a folder's middle, or dragging across folders, MOVES (the
//    existing behavior) and never writes an order.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DirEntry } from "../../../shared/ipc";
import { ProjectPaneContext } from "../lib/projectPane";
import { useApp } from "../store";
import { FileTree } from "./FileTree";

const initialState = useApp.getState();
const ROOT = "/workspace";
const ROOT_ENTRIES: DirEntry[] = [
  { name: "a.ts", type: "file" },
  { name: "b.ts", type: "file" },
  { name: "src", type: "dir" },
];
const SRC_ENTRIES: DirEntry[] = [{ name: "c.ts", type: "file" }];

let moveFile: ReturnType<typeof vi.fn>;
let setFileOrder: ReturnType<typeof vi.fn>;
let getFileOrder: ReturnType<typeof vi.fn>;

beforeEach(() => {
  moveFile = vi.fn(() => Promise.resolve(undefined));
  setFileOrder = vi.fn(() => Promise.resolve(undefined));
  // Configurable so a test can seed a saved order (the mount-time loadFileOrder
  // effect calls this and overwrites any directly-seeded store state).
  getFileOrder = vi.fn(() => Promise.resolve({}));
  window.airlock = new Proxy(
    {
      listDir: (_r: string, rel: string) =>
        Promise.resolve(rel === "src" ? SRC_ENTRIES : ROOT_ENTRIES),
      getFileOrder,
      moveFile,
      setFileOrder,
    },
    {
      get: (t, p) =>
        p in t
          ? (t as Record<string, unknown>)[p as string]
          : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
  useApp.setState(initialState, true);
});
afterEach(() => cleanup());

function seedRoot(): string {
  const tabId = useApp.getState().tabs[0]?.id as string;
  const cur = useApp.getState().tabState[tabId];
  if (!cur) throw new Error("no tabState");
  useApp.setState({
    tabState: {
      ...useApp.getState().tabState,
      [tabId]: { ...cur, root: ROOT },
    },
  });
  return tabId;
}
const renderTree = (tabId: string) =>
  render(
    <ProjectPaneContext.Provider value={tabId}>
      <FileTree />
    </ProjectPaneContext.Provider>,
  );
const dt = () => ({
  setData: vi.fn(),
  getData: vi.fn(() => ""),
  effectAllowed: "",
  dropEffect: "",
});
// jsdom getBoundingClientRect returns zeros; stub a real rect on a row so a
// chosen clientY lands in a known band.
function stubRect(el: Element, top: number, height: number) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    top,
    height,
    bottom: top + height,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
}

it("dragging a file below a sibling reorders within the folder", async () => {
  const tabId = seedRoot();
  const { findByText } = renderTree(tabId);
  const aRow = await findByText("a.ts");
  const bRow = await findByText("b.ts");
  stubRect(bRow, 0, 20);
  const data = dt();
  fireEvent.dragStart(aRow, { dataTransfer: data });
  fireEvent.dragOver(bRow, { dataTransfer: data, clientY: 15 }); // bottom half = after
  fireEvent.drop(bRow, { dataTransfer: data, clientY: 15 });
  // Root has three siblings; a.ts moves after b.ts, src keeps its tail spot.
  expect(setFileOrder).toHaveBeenCalledWith(ROOT, ".", ["b.ts", "a.ts", "src"]);
  expect(moveFile).not.toHaveBeenCalled();
});

it("dragging across folders moves (does not reorder)", async () => {
  const tabId = seedRoot();
  const { findByText } = renderTree(tabId);
  fireEvent.click(await findByText("src"));
  const cRow = await findByText("c.ts");
  const bRow = await findByText("b.ts");
  stubRect(bRow, 0, 20);
  const data = dt();
  fireEvent.dragStart(cRow, { dataTransfer: data });
  fireEvent.dragOver(bRow, { dataTransfer: data, clientY: 15 });
  fireEvent.drop(bRow, { dataTransfer: data, clientY: 15 });
  expect(moveFile).toHaveBeenCalledWith(ROOT, "src/c.ts", "c.ts");
  expect(setFileOrder).not.toHaveBeenCalled();
});

it("dragging a file onto a folder's middle moves it in", async () => {
  const tabId = seedRoot();
  const { findByText } = renderTree(tabId);
  const aRow = await findByText("a.ts");
  const srcRow = await findByText("src");
  stubRect(srcRow, 0, 20);
  const data = dt();
  fireEvent.dragStart(aRow, { dataTransfer: data });
  fireEvent.dragOver(srcRow, { dataTransfer: data, clientY: 10 }); // middle = into
  fireEvent.drop(srcRow, { dataTransfer: data, clientY: 10 });
  expect(moveFile).toHaveBeenCalledWith(ROOT, "a.ts", "src/a.ts");
  expect(setFileOrder).not.toHaveBeenCalled();
});

it("Sort A-Z clears a folder's custom order", async () => {
  // Seed through the mock: the mount-time loadFileOrder effect overwrites the
  // store with getFileOrder's result, so seeding the store directly would not
  // survive. findByText("Sort A-Z") then waits for the order to load + menu open.
  getFileOrder.mockReturnValue(Promise.resolve({ src: ["z.ts"] }));
  const tabId = seedRoot();
  const { findByText } = renderTree(tabId);
  const srcRow = await findByText("src");
  fireEvent.contextMenu(srcRow);
  fireEvent.click(await findByText("Sort A-Z"));
  expect(setFileOrder).toHaveBeenCalledWith(ROOT, "src", []);
});
