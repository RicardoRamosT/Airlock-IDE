// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { DirEntry } from "../../../shared/ipc";
import { ProjectPaneContext } from "../lib/projectPane";
import { useApp } from "../store";
import { FileTree } from "./FileTree";

const initialState = useApp.getState();
const ROOT = "/workspace";
const ENTRIES: DirEntry[] = [
  { name: "a.ts", type: "file" },
  { name: "b.ts", type: "file" },
];

beforeEach(() => {
  window.airlock = new Proxy(
    {
      listDir: () => Promise.resolve(ENTRIES),
      getFileOrder: () => Promise.resolve({ ".": ["b.ts", "a.ts"] }),
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

it("renders entries in the saved custom order", async () => {
  const tabId = seedRoot();
  const { container } = render(
    <ProjectPaneContext.Provider value={tabId}>
      <FileTree />
    </ProjectPaneContext.Provider>,
  );
  await waitFor(() => {
    // Read the name node, not the row's full textContent -- the row also
    // contains the decorative file-type badge ("TS").
    const rows = [...container.querySelectorAll(".tree-item .tree-label")].map(
      (n) => n.textContent,
    );
    // b.ts before a.ts per the saved order (default sort would be a, b).
    expect(rows).toEqual(["b.ts", "a.ts"]);
  });
});
