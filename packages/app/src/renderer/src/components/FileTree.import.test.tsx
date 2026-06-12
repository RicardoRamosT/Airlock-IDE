// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DirEntry } from "../../../shared/ipc";
import { ProjectPaneContext } from "../lib/projectPane";
import { useApp } from "../store";
import { FileTree } from "./FileTree";

const initialState = useApp.getState();
const ROOT = "/workspace";
const ENTRIES: DirEntry[] = [
  { name: "a.ts", type: "file" },
  { name: "src", type: "dir" },
];

let importExternal: ReturnType<typeof vi.fn>;

beforeEach(() => {
  importExternal = vi.fn(() =>
    Promise.resolve({ imported: ["x.pdf"], failed: [] }),
  );
  window.airlock = new Proxy(
    {
      listDir: () => Promise.resolve(ENTRIES),
      getPathForFile: (f: File) => `/abs/${f.name}`,
      importExternal,
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

afterEach(cleanup);

const get = () => useApp.getState();
function seedRoot(): string {
  const tabId = get().tabs[0]?.id;
  if (!tabId) throw new Error("no tab");
  const cur = get().tabState[tabId];
  useApp.setState({
    tabState: { ...get().tabState, [tabId]: { ...cur, root: ROOT } as never },
  });
  return tabId;
}
const renderTree = (tabId: string) =>
  render(
    <ProjectPaneContext.Provider value={tabId}>
      <FileTree />
    </ProjectPaneContext.Provider>,
  );

const fileDrop = (files: { name: string }[]) => ({
  dataTransfer: { types: ["Files"], files, getData: () => "", dropEffect: "" },
});

it("dropping Finder files on a folder row imports into that folder", async () => {
  const tabId = seedRoot();
  const { findByText } = renderTree(tabId);
  const dirRow = await findByText("src");
  fireEvent.drop(dirRow, fileDrop([{ name: "x.pdf" }]));
  await waitFor(() =>
    expect(importExternal).toHaveBeenCalledWith(ROOT, "src", ["/abs/x.pdf"]),
  );
});

it("dropping on a file row imports into its parent (root here)", async () => {
  const tabId = seedRoot();
  const { findByText } = renderTree(tabId);
  const fileRow = await findByText("a.ts");
  fireEvent.drop(fileRow, fileDrop([{ name: "y.pdf" }]));
  await waitFor(() =>
    expect(importExternal).toHaveBeenCalledWith(ROOT, ".", ["/abs/y.pdf"]),
  );
});

it("ignores an internal move drag (no importExternal call)", async () => {
  const tabId = seedRoot();
  const { findByText } = renderTree(tabId);
  const dirRow = await findByText("src");
  fireEvent.drop(dirRow, {
    dataTransfer: { types: ["text/plain"], files: [], getData: () => "a.ts" },
  });
  await new Promise((r) => setTimeout(r, 0));
  expect(importExternal).not.toHaveBeenCalled();
});
