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
let windowClose: ReturnType<typeof vi.fn>;

function stubApi(target: DropTarget) {
  tabDragStart = vi.fn(() => Promise.resolve(undefined));
  tabDragEnd = vi.fn(() => Promise.resolve(target));
  windowClose = vi.fn(() => Promise.resolve(undefined));
  window.airlock = new Proxy(
    {
      tabDragStart,
      tabDragEnd,
      windowClose,
      windowId: () => Promise.resolve(1),
    },
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
  expect(tabDragStart).toHaveBeenCalledWith("B", true);
  fireEvent.dragEnd(label, { dataTransfer: dt() });
  expect(tabDragEnd).toHaveBeenCalledWith(
    expect.objectContaining({ root: "/b" }),
    true, // canDetach: another tab stays behind, so a new window is allowed
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

// Only "/b" left, which is the shape of a window a tab was just torn off into.
function loneTab(): void {
  const only = useApp.getState().tabs.find((t) => t.root === "/b");
  if (!only) throw new Error("seed failed");
  useApp.setState((s) => ({ tabs: s.tabs.filter((t) => t.id === only.id) }));
}

it("sends a null payload for a pair/page-tab (nothing that can move)", async () => {
  useApp.setState({ settingsTabOpen: true });
  render(<ProjectTabs />);
  const label = screen.getByText("Settings");
  fireEvent.dragStart(label, { dataTransfer: dt() });
  fireEvent.dragEnd(label, { dataTransfer: dt() });
  expect(tabDragEnd).toHaveBeenCalledWith(null, true);
});

it("never offers a new window to a window's last tab", async () => {
  // Main's hover hints are computed from the cursor alone, so it has to be TOLD
  // that this release cannot open a window -- otherwise the follow-the-cursor
  // label promises "Release to open B in a new window" and the drop does
  // nothing, which is the same lie the unmergeable last tab told.
  loneTab();
  render(<ProjectTabs />);
  fireEvent.dragStart(screen.getByText("B"), { dataTransfer: dt() });
  expect(tabDragStart).toHaveBeenCalledWith("B", false);
});

it("ships a window's LAST tab too, so it can be merged back in", async () => {
  // A torn-off window holds exactly ONE tab. Withholding the payload here is what
  // made such a window impossible to put back: main resolved the merge target,
  // found nothing to move and silently did nothing -- while the target window had
  // already offered "Drop to add B here".
  stubApi({ kind: "merge", windowId: 2 });
  loneTab();
  render(<ProjectTabs />);
  const label = screen.getByText("B");
  fireEvent.dragStart(label, { dataTransfer: dt() });
  fireEvent.dragEnd(label, { dataTransfer: dt() });
  expect(tabDragEnd).toHaveBeenCalledWith(
    expect.objectContaining({ root: "/b" }),
    false, // canDetach: this window is already that project's own window
  );
  await vi.waitFor(() =>
    expect(useApp.getState().tabs.some((t) => t.root === "/b")).toBe(false),
  );
});

it("closes the window whose last tab merged away", async () => {
  // Merging the last tab back is how a tear-off is UNDONE. Leaving the emptied
  // window behind would make the round trip only half work.
  stubApi({ kind: "merge", windowId: 2 });
  loneTab();
  render(<ProjectTabs />);
  const label = screen.getByText("B");
  fireEvent.dragStart(label, { dataTransfer: dt() });
  fireEvent.dragEnd(label, { dataTransfer: dt() });
  await vi.waitFor(() => expect(windowClose).toHaveBeenCalled());
});

it("keeps that window when an IDE page-tab still lives in it", async () => {
  stubApi({ kind: "merge", windowId: 2 });
  loneTab();
  useApp.setState({ settingsTabOpen: true });
  render(<ProjectTabs />);
  const label = screen.getByText("B");
  fireEvent.dragStart(label, { dataTransfer: dt() });
  fireEvent.dragEnd(label, { dataTransfer: dt() });
  // Wait for the MOVE, not just the call: main's reply is handled a microtask
  // later, so asserting on tabDragEnd alone would pass before the window-close
  // decision has been made at all.
  await vi.waitFor(() =>
    expect(useApp.getState().tabs.some((t) => t.root === "/b")).toBe(false),
  );
  expect(windowClose).not.toHaveBeenCalled();
});

it("does not close a window whose dragged tab vanished mid-flight", async () => {
  // Between the release and main's answer, the tab can stop being this window's
  // -- closed from a menu, or already gone. Counting tabs alone would then read
  // "one left, so we are empty" and close a window still showing a live project.
  stubApi({ kind: "merge", windowId: 2 });
  const a = useApp.getState().tabs.find((t) => t.root === "/a");
  const b = useApp.getState().tabs.find((t) => t.root === "/b");
  if (!a || !b) throw new Error("seed failed");
  useApp.setState((st) => ({
    tabs: st.tabs.filter((t) => t.id === a.id || t.id === b.id),
  }));
  render(<ProjectTabs />);
  const label = screen.getByText("B");
  fireEvent.dragStart(label, { dataTransfer: dt() });
  fireEvent.dragEnd(label, { dataTransfer: dt() });
  // Synchronous, so it lands before main's reply is delivered on the microtask.
  // One tab is left, but it is NOT the one that was dragged.
  useApp.setState((st) => ({ tabs: st.tabs.filter((t) => t.id !== b.id) }));
  // Nothing observable changes on this path, so drain the microtask queue rather
  // than wait on a condition -- otherwise the assertion below runs before main's
  // reply is handled and would pass however broken the decision is.
  await act(async () => {});
  expect(windowClose).not.toHaveBeenCalled();
  expect(useApp.getState().tabs.some((t) => t.root === "/a")).toBe(true);
});

it("leaves the window alone when a tab merges away but others remain", async () => {
  stubApi({ kind: "merge", windowId: 2 });
  render(<ProjectTabs />);
  const label = screen.getByText("B");
  fireEvent.dragStart(label, { dataTransfer: dt() });
  fireEvent.dragEnd(label, { dataTransfer: dt() });
  await vi.waitFor(() =>
    expect(useApp.getState().tabs.some((t) => t.root === "/b")).toBe(false),
  );
  expect(windowClose).not.toHaveBeenCalled();
});
