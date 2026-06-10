import { afterEach, beforeEach, expect, it } from "vitest";
import { useApp } from "./store";

const initialState = useApp.getState();
beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    airlock: {
      workspaceRoots: () => Promise.resolve(),
      workspaceSetActive: () => Promise.resolve(),
      workspaceClose: () => Promise.resolve(),
    },
  };
  useApp.setState(initialState, true);
});
afterEach(() => useApp.setState(initialState, true));

it("settings and usage page-tabs can BOTH be open; appPage selects the shown one", () => {
  useApp.getState().openAppPage("settings");
  useApp.getState().openAppPage("usage");
  expect(useApp.getState().settingsTabOpen).toBe(true);
  expect(useApp.getState().usageTabOpen).toBe(true);
  expect(useApp.getState().appPage).toBe("usage");
  useApp.getState().showAppPage("settings");
  expect(useApp.getState().appPage).toBe("settings");
  expect(useApp.getState().usageTabOpen).toBe(true); // tab kept
});

it("selecting a project tab hides the page but keeps its tab open", () => {
  useApp.getState().openBlankTab();
  const other = useApp.getState().activeTabId;
  useApp.getState().openAppPage("usage");
  expect(useApp.getState().appPage).toBe("usage");
  useApp.getState().switchTab(other); // re-click the active project tab
  expect(useApp.getState().appPage).toBeNull();
  expect(useApp.getState().usageTabOpen).toBe(true);
});

it("closing a page-tab drops it (and hides it when it was shown)", () => {
  useApp.getState().openAppPage("settings");
  useApp.getState().closeAppPage("settings");
  expect(useApp.getState().appPage).toBeNull();
  expect(useApp.getState().settingsTabOpen).toBe(false);
});

it("setSettingsOpen shim drives the page-tab (existing callers keep working)", () => {
  useApp.getState().setSettingsOpen(true);
  expect(useApp.getState().appPage).toBe("settings");
  expect(useApp.getState().settingsTabOpen).toBe(true);
  useApp.getState().setSettingsOpen(false);
  expect(useApp.getState().appPage).toBeNull();
  expect(useApp.getState().settingsTabOpen).toBe(false);
});
