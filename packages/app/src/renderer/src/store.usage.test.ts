import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

describe("an IDE page reclaims the sidebar, whatever opened it", () => {
  // This used to live only in the rail's hub handler, so the same page opened
  // two different ways: the icon collapsed the sidebar, open_app_page (MCP,
  // menus) left the page rendering beside a FILES tree it has nothing to do
  // with. Now it is in openAppPage, so every entry point agrees.
  it("collapses the sidebar and gives it back when the last page closes", () => {
    useApp.setState({ sidebarVisible: true, pageHidSidebar: false });
    useApp.getState().openAppPage("settings");
    expect(useApp.getState().sidebarVisible).toBe(false);
    expect(useApp.getState().pageHidSidebar).toBe(true);

    useApp.getState().closeAppPage("settings");
    expect(useApp.getState().sidebarVisible).toBe(true);
    expect(useApp.getState().pageHidSidebar).toBe(false);
  });

  it("holds the sidebar until the LAST page closes", () => {
    useApp.setState({ sidebarVisible: true, pageHidSidebar: false });
    useApp.getState().openAppPage("settings");
    useApp.getState().openAppPage("usage");
    useApp.getState().closeAppPage("settings");
    // Usage is still open, so the sidebar stays away.
    expect(useApp.getState().sidebarVisible).toBe(false);
    useApp.getState().closeAppPage("usage");
    expect(useApp.getState().sidebarVisible).toBe(true);
  });

  it("never forces a sidebar on someone who had already collapsed it", () => {
    // The whole point of remembering WE took it.
    useApp.setState({ sidebarVisible: false, pageHidSidebar: false });
    useApp.getState().openAppPage("usage");
    expect(useApp.getState().pageHidSidebar).toBe(false);
    useApp.getState().closeAppPage("usage");
    expect(useApp.getState().sidebarVisible).toBe(false);
  });
});
