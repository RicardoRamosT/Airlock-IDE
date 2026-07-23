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

it("renders the window title in a non-interactive card (no context menu)", () => {
  useApp.getState().openProject("/Users/me/proj");
  render(<TitleBar />);
  expect(screen.getByText("AirLock - proj")).toBeTruthy();
  // The title is passive now: right-clicking it opens nothing.
  fireEvent.contextMenu(screen.getByText("AirLock - proj"));
  expect(screen.queryByText("Overview")).toBeNull();
});

it("shows just 'AirLock' with no active project", () => {
  render(<TitleBar />);
  expect(screen.getByText("AirLock")).toBeTruthy();
});
