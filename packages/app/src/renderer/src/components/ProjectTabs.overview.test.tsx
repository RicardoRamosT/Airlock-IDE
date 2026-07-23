// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useApp } from "../store";
import { ProjectTabs } from "./ProjectTabs";

const initial = useApp.getState();
beforeEach(() => {
  useApp.setState(initial, true);
  (window as unknown as { airlock: unknown }).airlock = new Proxy(
    {},
    { get: () => () => Promise.resolve(undefined) },
  );
});
afterEach(cleanup);

// Two real project tabs so the strip renders; focus is the last opened.
function twoProjects() {
  useApp.getState().openProject("/a");
  useApp.getState().openProject("/b");
  useApp.setState({ openProjectsAsTabs: true });
}

it("the focused project shows an inline Overview entry that opens its overview", () => {
  twoProjects();
  const focused = useApp.getState().tabs.find((t) => t.root === "/b");
  useApp.setState({ activeTabId: focused?.id });
  render(<ProjectTabs />);
  const overviewBtns = screen.getAllByRole("button", { name: /overview/i });
  expect(overviewBtns).toHaveLength(1); // only the focused folder
  fireEvent.click(overviewBtns[0] as HTMLElement);
  expect(useApp.getState().appPage).toBe("overview");
  expect(useApp.getState().overviewRoot).toBe("/b");
});

it("a blank focused tab shows no Overview entry", () => {
  useApp.getState().openProject("/a");
  useApp.setState({ openProjectsAsTabs: true });
  useApp.getState().openBlankTab(); // blank tab becomes active
  render(<ProjectTabs />);
  expect(screen.queryByRole("button", { name: /overview/i })).toBeNull();
});
