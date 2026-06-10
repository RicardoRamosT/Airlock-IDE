import { afterEach, beforeEach, expect, it } from "vitest";
import { useApp } from "./store";

const initialState = useApp.getState();
beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    airlock: { workspaceRoots: () => Promise.resolve() },
  };
  useApp.setState(initialState, true);
});
afterEach(() => useApp.setState(initialState, true));

it("usage and settings pages exclude each other (one page at a time)", () => {
  useApp.getState().setSettingsOpen(true);
  useApp.getState().setUsageOpen(true);
  const active = useApp.getState().activeTabId;
  expect(useApp.getState().usageOpen).toBe(true);
  expect(useApp.getState().tabState[active]?.settingsOpen).toBe(false);
  useApp.getState().setSettingsOpen(true);
  expect(useApp.getState().usageOpen).toBe(false);
  expect(useApp.getState().tabState[active]?.settingsOpen).toBe(true);
});

it("a focused-pane scene change dismisses the usage page", () => {
  useApp.getState().setUsageOpen(true);
  expect(useApp.getState().usageOpen).toBe(true);
  // Adding a terminal re-sets the focused tab's scene -- the page closes the
  // same way Settings/DB do when the user clicks back into real tabs.
  useApp.getState().addTerminal();
  expect(useApp.getState().usageOpen).toBe(false);
});
