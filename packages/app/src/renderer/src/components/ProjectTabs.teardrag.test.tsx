// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
  // The tab's NAME rides along, so each window's hint can say which project it is
  // about to take.
  expect(tabDragStart).toHaveBeenCalledWith("B");
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

it("tells you what releasing will do, naming the dragged project", async () => {
  // Drive the hover broadcast main sends during a drag. The drop is what commits
  // the move, so this hint is the only thing that says a window is coming.
  let hover: ((h: unknown) => void) | null = null;
  window.airlock = new Proxy(
    {
      tabDragStart,
      tabDragEnd,
      windowId: () => Promise.resolve(7),
      onTabDragHover: (cb: (h: unknown) => void) => {
        hover = cb;
        return () => {};
      },
    },
    {
      get: (t, p) =>
        p in t
          ? (t as Record<string, unknown>)[p as string]
          : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;

  render(<ProjectTabs />);
  await vi.waitFor(() => expect(hover).toBeTruthy());

  // Cursor outside every window, drag started HERE -> offer the new window.
  act(() => {
    hover?.({
      target: { kind: "detach" },
      sourceWindowId: 7,
      label: "Airlock",
    });
  });
  expect(
    await screen.findByText(/Release to open Airlock in a new window/),
  ).toBeTruthy();

  // Cursor over THIS window while another window owns the drag -> offer to take it.
  act(() => {
    hover?.({
      target: { kind: "merge", windowId: 7 },
      sourceWindowId: 99,
      label: "Airlock",
    });
  });
  expect(await screen.findByText(/Drop to add Airlock here/)).toBeTruthy();

  // Back inside its own window -> a plain reorder, so no hint at all.
  act(() => {
    hover?.({
      target: { kind: "reorder" },
      sourceWindowId: 7,
      label: "Airlock",
    });
  });
  expect(screen.queryByText(/Release to open/)).toBeNull();
  expect(screen.queryByText(/Drop to add/)).toBeNull();
});

it("tells main the drag ended even when the drop already cleared the strip", async () => {
  // HTML5 fires `drop` BEFORE `dragend`, and the drop clears the strip's drag
  // state. dragEnd is the ONLY path that stops main's cursor poll, so it has to
  // report regardless -- a leaked poll shows a phantom "Release to open ..."
  // label on every later mouse-exit and takes the macOS dock tile with it.
  stubApi({ kind: "reorder" }); // an in-window drop resolves to a reorder
  render(<ProjectTabs />);
  const label = screen.getByText("B");
  fireEvent.dragStart(label, { dataTransfer: dt() });
  const list = document.querySelector(".project-tabs-list");
  if (!list) throw new Error("tab list missing");
  fireEvent.drop(list, { dataTransfer: dt() });
  fireEvent.dragEnd(label, { dataTransfer: dt() });
  expect(tabDragEnd).toHaveBeenCalled();
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
