import { useCallback } from "react";
import { ProjectPaneContext } from "../lib/projectPane";
import { useTerminalSlots } from "../lib/terminalSlots";
import { useApp } from "../store";
import { DataGrid } from "./DataGrid";
import { SettingsTab } from "./SettingsTab";
import { Sidebar } from "./Sidebar";
import { Viewer } from "./Viewer";

// One full project view (Sidebar + viewer-pane + terminals) scoped to a single
// tab. App.tsx renders one of these for the single (focused) pane, or two side
// by side when split. Everything inside reads ITS tab via ProjectPaneContext
// (T2): Sidebar/Viewer/DataGrid/SettingsTab resolve their own project's state.
//
// The terminals are NOT rendered here -- TerminalManager (mounted once at app
// root) PORTALS each tab's ProjectTerminals into the `pane-terminal-slot` div
// below. The slot registers itself in the terminal-slot registry so the right
// tab's already-mounted terminals appear in this pane without remounting (ptys
// survive split toggles / focus swaps / tab switches). On unmount the slot
// unregisters, so that tab's terminals fall back to the hidden keep-alive div.
//
// Clicking anywhere in the pane focuses it: onFocusCapture + onMouseDownCapture
// call switchTab(tabId), which handles the active<->split swap and the agent /
// window-title resync. `focused` (tabId === activeTabId) draws a subtle ring.
export function ProjectPane({
  tabId,
  focused,
}: {
  tabId: string;
  focused: boolean;
}) {
  const { register, unregister } = useTerminalSlots();
  // App-global sidebar position/visibility apply to BOTH panes' sidebars.
  const sidebarPosition = useApp((s) => s.sidebarPosition);
  const sidebarVisible = useApp((s) => s.sidebarVisible);
  // The viewer-pane discriminator, computed from THIS tab's state (mirrors the
  // mutual exclusion the store enforces: only one of these is set at a time).
  const selectedFile = useApp((s) => s.tabState[tabId]?.selectedFile ?? null);
  const diff = useApp((s) => s.tabState[tabId]?.diff ?? null);
  const settingsOpen = useApp((s) => s.tabState[tabId]?.settingsOpen ?? false);
  const dbView = useApp((s) => s.tabState[tabId]?.dbView ?? null);

  // Ref callback (React 19): register this element under tabId; the returned
  // cleanup unregisters the EXACT element so a fast remount that registers the
  // new target first is not clobbered by the old element's late cleanup.
  const slotRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      register(tabId, el);
      return () => unregister(tabId, el);
    },
    [tabId, register, unregister],
  );

  const focus = () => useApp.getState().switchTab(tabId);

  return (
    <ProjectPaneContext.Provider value={tabId}>
      <div
        className={`project-pane${focused ? " focused" : ""}`}
        onFocusCapture={focus}
        onMouseDownCapture={focus}
      >
        <div
          className={`layout${sidebarPosition === "right" ? " sidebar-right" : ""}${sidebarVisible ? "" : " sidebar-hidden"}`}
        >
          <Sidebar />
          <div
            className={`main${selectedFile || diff || settingsOpen || dbView ? " split" : ""}`}
          >
            <div className="viewer-pane">
              {dbView ? (
                <DataGrid />
              ) : settingsOpen ? (
                <SettingsTab />
              ) : (
                <Viewer />
              )}
            </div>
            {/* Portal target for THIS tab's terminals (mounted in
                TerminalManager). Empty in the DOM until the portal fills it. */}
            <div className="terminal-slot pane-terminal-slot" ref={slotRef} />
          </div>
        </div>
      </div>
    </ProjectPaneContext.Provider>
  );
}
