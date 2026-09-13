// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useApp } from "../store";
import { TitleBar } from "./TitleBar";

const initial = useApp.getState();

beforeEach(() => {
  useApp.setState(initial, true);
  // Permissive stub so any child IPC call is an inert no-op under jsdom.
  // onAgentRequests is explicit because it is a SUBSCRIPTION: the titlebar hosts
  // NotificationBell, whose hook calls the returned unsubscribe on unmount, so a
  // generic promise-returning stub would throw there.
  (window as unknown as { airlock: unknown }).airlock = new Proxy(
    { onAgentRequests: () => () => {} },
    {
      get: (t, k) =>
        k in t ? t[k as keyof typeof t] : () => Promise.resolve(undefined),
    },
  );
});
afterEach(cleanup);

it("renders the window title in a non-interactive card (no context menu)", () => {
  useApp.getState().openProject("/Users/me/proj");
  render(<TitleBar />);
  expect(screen.getByText("Proj \u00b7 AirLock")).toBeTruthy();
  // The title is passive now: right-clicking it opens nothing.
  fireEvent.contextMenu(screen.getByText("Proj \u00b7 AirLock"));
  expect(screen.queryByText("Overview")).toBeNull();
});

it("shows just 'AirLock' with no active project", () => {
  render(<TitleBar />);
  expect(screen.getByText("AirLock")).toBeTruthy();
});
