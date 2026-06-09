// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { SECTION_META } from "../lib/sections";
import { useApp } from "../store";
import { Sidebar } from "./Sidebar";

const initialState = useApp.getState();

beforeEach(() => {
  useApp.setState(initialState, true);
  // Sections only hit window.airlock lazily (fetch-on-mount paths); a resolve-
  // undefined Proxy keeps any of them harmless, mirroring App.smoke.test.tsx.
  window.airlock = new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop.startsWith("on")
          ? () => () => {}
          : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
});

afterEach(cleanup);

// Minimal per-tab state: Sidebar itself only reads tabState[tabId]?.root.
const pane = (root: string | null) =>
  ({ root }) as unknown as (typeof initialState.tabState)[string];

it("shows the active view's title and only that view", () => {
  useApp.getState().setActiveView("secrets");
  render(<Sidebar />);
  expect(screen.getByText("Secrets")).toBeTruthy();
  expect(screen.queryByText("Open Folder…")).toBeNull(); // files view absent
});

it("files view without a root offers Open Folder", () => {
  useApp.getState().setActiveView("files");
  render(<Sidebar />);
  expect(screen.getByText("Files")).toBeTruthy();
  expect(screen.getByText("Open Folder…")).toBeTruthy();
});

it("falls back to the first visible view when the active one is hidden", () => {
  useApp.getState().setActiveView("git");
  useApp.setState({
    sectionVisibility: {
      ...useApp.getState().sectionVisibility,
      git: false,
    },
  });
  render(<Sidebar />);
  expect(screen.getByText("Files")).toBeTruthy();
});

it("shows the hidden-everything note when no section is visible", () => {
  useApp.setState({
    sectionVisibility: Object.fromEntries(
      SECTION_META.map((m) => [m.id, false]),
    ) as (typeof initialState)["sectionVisibility"],
  });
  render(<Sidebar />);
  expect(screen.getByText(/All sections hidden/)).toBeTruthy();
});

it("renders the quota meter exactly once", () => {
  useApp.setState({ quotaMeterEnabled: true, quota: null });
  const { container } = render(<Sidebar />);
  expect(container.querySelectorAll(".quota-meter").length).toBe(1);
});

it("badges the focused pane's project name while a split is showing", () => {
  const t1 = useApp.getState().activeTabId;
  useApp.setState({
    tabs: [
      { id: t1, root: "/tmp/projA" },
      { id: "t2", root: "/tmp/projB" },
    ],
    split: { a: t1, b: "t2" },
    activeTabId: "t2",
    tabState: {
      ...useApp.getState().tabState,
      [t1]: pane("/tmp/projA"),
      t2: pane("/tmp/projB"),
    },
  });
  render(<Sidebar />);
  expect(screen.getByText("projB")).toBeTruthy(); // focused pane's basename
});
