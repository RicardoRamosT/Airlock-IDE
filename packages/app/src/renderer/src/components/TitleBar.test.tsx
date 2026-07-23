// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useApp } from "../store";
import { TitleBar } from "./TitleBar";

const initial = useApp.getState();

beforeEach(() => {
  useApp.setState(initial, true);
  // Permissive stub so any child IPC call is an inert no-op under jsdom.
  (window as unknown as { airlock: unknown }).airlock = new Proxy(
    {},
    { get: () => () => Promise.resolve(undefined) },
  );
});
afterEach(cleanup);

function clickOverviewFromTitleMenu() {
  render(<TitleBar />);
  fireEvent.contextMenu(screen.getByText("AirLock - proj"));
  fireEvent.click(screen.getByText("Overview"));
}

it("tabs ON: right-click name → Overview shows the overview page", () => {
  useApp.getState().openProject("/Users/me/proj");
  useApp.setState({ openProjectsAsTabs: true });
  clickOverviewFromTitleMenu();
  const st = useApp.getState();
  expect(st.appPage).toBe("overview");
  expect(st.overviewRoot).toBe("/Users/me/proj");
});

it("tabs OFF: right-click name → Overview shows the overview page", () => {
  useApp.getState().openProject("/Users/me/proj");
  useApp.setState({ openProjectsAsTabs: false });
  clickOverviewFromTitleMenu();
  const st = useApp.getState();
  expect(st.appPage).toBe("overview");
  expect(st.overviewRoot).toBe("/Users/me/proj");
});

it("no active project: right-clicking the bare title shows no menu", () => {
  render(<TitleBar />);
  fireEvent.contextMenu(screen.getByText("AirLock"));
  expect(screen.queryByText("Overview")).toBeNull();
});
