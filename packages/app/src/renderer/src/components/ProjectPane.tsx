import { useCallback } from "react";
import { ProjectPaneContext } from "../lib/projectPane";
import { useTerminalSlots } from "../lib/terminalSlots";
import { useApp } from "../store";
import { DataGrid } from "./DataGrid";
import { MainTabs } from "./MainTabs";
import { SettingsTab } from "./SettingsTab";
import { Sidebar } from "./Sidebar";
import { Viewer } from "./Viewer";

// One full project view (Sidebar + a unified main area) scoped to a single tab.
// The main area is a unified tab bar (terminals + open files) over a content
// region that shows the active TERMINAL or file EDITOR -- or both side by side
// when split. Git diff / Settings / DB are overlays that take the content region
// while the tab bar persists; closing one returns to the editor/terminal.
//
// Terminals are NOT rendered here -- TerminalManager (mounted once) PORTALS each
// tab's ProjectTerminals into the `pane-terminal-slot` below. The slot is
// rendered ONLY while the terminal is visible; when the editor is full, the slot
// unmounts and that tab's terminals fall back to the hidden keep-alive (the pty
// stays alive). Clicking anywhere focuses the pane (switchTab).
export function ProjectPane({
  tabId,
  focused,
}: {
  tabId: string;
  focused: boolean;
}) {
  const { register, unregister } = useTerminalSlots();
  const sidebarPosition = useApp((s) => s.sidebarPosition);
  const sidebarVisible = useApp((s) => s.sidebarVisible);
  const selectedFile = useApp((s) => s.tabState[tabId]?.selectedFile ?? null);
  const diff = useApp((s) => s.tabState[tabId]?.diff ?? null);
  const settingsOpen = useApp((s) => s.tabState[tabId]?.settingsOpen ?? false);
  const dbView = useApp((s) => s.tabState[tabId]?.dbView ?? null);
  const mainPrimary = useApp(
    (s) => s.tabState[tabId]?.mainPrimary ?? "terminal",
  );
  const mainSplit = useApp((s) => s.tabState[tabId]?.mainSplit ?? false);

  // db/settings are full overlays. Otherwise the editor side shows when there is
  // a diff or an active file chosen as primary (or in a split); the terminal
  // fills whatever the editor does not (and always shows alongside in a split).
  const overlay = !!dbView || settingsOpen;
  const editorVisible =
    !overlay &&
    (!!diff || (!!selectedFile && (mainPrimary === "editor" || mainSplit)));
  const terminalVisible = !overlay && (mainSplit || !editorVisible);

  // Ref callback (React 19): register THIS slot element under tabId; the cleanup
  // unregisters the exact element. Rendered only when terminalVisible, so an
  // editor-only view sends the terminals to the keep-alive (ptys preserved).
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
          <div className="main">
            <MainTabs tabId={tabId} />
            {dbView ? (
              <div className="main-content">
                <DataGrid />
              </div>
            ) : settingsOpen ? (
              <div className="main-content">
                <SettingsTab />
              </div>
            ) : (
              <div
                className={`main-content main-panes${editorVisible && terminalVisible ? " split" : ""}`}
              >
                {editorVisible && (
                  <div className="editor-area">
                    <Viewer />
                  </div>
                )}
                {terminalVisible && (
                  <div
                    className="terminal-slot pane-terminal-slot"
                    ref={slotRef}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </ProjectPaneContext.Provider>
  );
}
