// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DropTarget } from "../../../shared/ipc";
import { useApp } from "../store";
import { ProjectTabs } from "./ProjectTabs";

const initial = useApp.getState();
let tabDragStart: ReturnType<typeof vi.fn>;
let tabDragEnd: ReturnType<typeof vi.fn>;

function stubApi(target: DropTarget) {
  tabDragStart = vi.fn(() => Promise.resolve(undefined));
  tabDragEnd = vi.fn(() => Promise.resolve(target));
  window.airlock = new Proxy(
    { tabDragStart, tabDragEnd, windowId: () => Promise.resolve(1) },
    {
      get: (t, p) =>
        p in t
          ? (t as Record<string, unknown>)[p as string]
          : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
}

beforeEach(() => {
  useApp.setState(initial, true);
  stubApi({ kind: "detach" });
  useApp.getState().openProject("/a");
  useApp.getState().openProject("/b");
});
afterEach(cleanup);

// Minimal DataTransfer for the drag events.
const dt = () => ({
  effectAllowed: "",
  setData: vi.fn(),
  setDragImage: vi.fn(),
});

it("starts the cross-window drag and hands main the tab payload", async () => {
  render(<ProjectTabs />);
  const label = screen.getByText("B");
  fireEvent.dragStart(label, { dataTransfer: dt() });
  expect(tabDragStart).toHaveBeenCalled();
  fireEvent.dragEnd(label, { dataTransfer: dt() });
  expect(tabDragEnd).toHaveBeenCalledWith(
    expect.objectContaining({ root: "/b" }),
  );
});

it("removes the tab only after main confirms a real move", async () => {
  render(<ProjectTabs />);
  const label = screen.getByText("B");
  const before = useApp.getState().tabs.length;
  fireEvent.dragStart(label, { dataTransfer: dt() });
  fireEvent.dragEnd(label, { dataTransfer: dt() });
  await vi.waitFor(() =>
    expect(useApp.getState().tabs).toHaveLength(before - 1),
  );
  expect(useApp.getState().tabs.some((t) => t.root === "/b")).toBe(false);
});

it("keeps the tab when the drop resolves to a plain reorder", async () => {
  stubApi({ kind: "reorder" });
  render(<ProjectTabs />);
  const label = screen.getByText("B");
  const before = useApp.getState().tabs.length;
  fireEvent.dragStart(label, { dataTransfer: dt() });
  fireEvent.dragEnd(label, { dataTransfer: dt() });
  await vi.waitFor(() => expect(tabDragEnd).toHaveBeenCalled());
  // An in-window drag must be a true no-op: the tab never left.
  expect(useApp.getState().tabs).toHaveLength(before);
  expect(useApp.getState().tabs.some((t) => t.root === "/b")).toBe(true);
});

it("sends a null payload for a window's last tab (nothing to move)", async () => {
  const only = useApp.getState().tabs.find((t) => t.root === "/b");
  if (!only) throw new Error("seed failed");
  useApp.setState((s) => ({ tabs: s.tabs.filter((t) => t.id === only.id) }));
  render(<ProjectTabs />);
  const label = screen.getByText("B");
  fireEvent.dragStart(label, { dataTransfer: dt() });
  fireEvent.dragEnd(label, { dataTransfer: dt() });
  expect(tabDragEnd).toHaveBeenCalledWith(null);
  expect(useApp.getState().tabs).toHaveLength(1);
});
