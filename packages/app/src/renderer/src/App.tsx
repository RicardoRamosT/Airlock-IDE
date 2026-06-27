import type React from "react";
import { ActivityBar } from "./components/ActivityBar";
import { AddDatabaseModal } from "./components/AddDatabaseModal";
import { NeonConnectModal } from "./components/NeonConnectModal";
import { OverviewTab } from "./components/OverviewTab";
import { Palette } from "./components/Palette";
import { ProjectPane } from "./components/ProjectPane";
import { ProjectTabs } from "./components/ProjectTabs";
import { ReferencesPanel } from "./components/ReferencesPanel";
import { RenderConnectModal } from "./components/RenderConnectModal";
import { SearchPanel } from "./components/SearchPanel";
import { SecretModal } from "./components/SecretModal";
import { SettingsTab } from "./components/SettingsTab";
import { Sidebar } from "./components/Sidebar";
import { SidebarResizer } from "./components/SidebarResizer";
import { StatusBar } from "./components/StatusBar";
import { TerminalGrantModal } from "./components/TerminalGrantModal";
import { TerminalManager } from "./components/TerminalManager";
import { TitleBar } from "./components/TitleBar";
import { UsageTab } from "./components/UsageTab";
import { TerminalSlotsProvider } from "./lib/terminalSlots";
import { useAgentCommands } from "./lib/useAgentCommands";
import { useAnthropicStatus } from "./lib/useAnthropicStatus";
import { useFsWatch } from "./lib/useFsWatch";
import { useGitStatus } from "./lib/useGitStatus";
import { useMenuActions } from "./lib/useMenuActions";
import { usePrefs } from "./lib/usePrefs";
import { useQuota } from "./lib/useQuota";
import { useSessionPersist } from "./lib/useSessionPersist";
import { useSessionRestore } from "./lib/useSessionRestore";
import { useUpdate } from "./lib/useUpdate";
import { useApp } from "./store";

export function App() {
  useGitStatus();
  usePrefs();
  useSessionPersist();
  useSessionRestore();
  useMenuActions();
  useAgentCommands();
  useFsWatch();
  useQuota();
  useAnthropicStatus();
  useUpdate();
  const modal = useApp((s) => s.modal);
  const activeTabId = useApp((s) => s.activeTabId);
  const searchOpen = useApp((s) => s.searchOpen);
  const split = useApp((s) => s.split);
  const sidebarVisible = useApp((s) => s.sidebarVisible);
  const sidebarPosition = useApp((s) => s.sidebarPosition);
  const sidebarWidth = useApp((s) => s.sidebarWidth);
  const appPage = useApp((s) => s.appPage);
  const overviewRoot = useApp((s) => s.overviewRoot);
  const openProjectsAsTabs = useApp((s) => s.openProjectsAsTabs);
  // Show the split ONLY when the focused tab is a member of the pair: switching
  // to a non-pair tab hides the split (the pair persists in `split`), switching
  // back to a member shows it again. Left = a (primary), right = b (secondary);
  // the focused pane (=== activeTabId) drives the agent / window title.
  const showSplit =
    split !== null && (activeTabId === split.a || activeTabId === split.b);
  return (
    <TerminalSlotsProvider>
      <div className="app-shell">
        <TitleBar />
        <ProjectTabs />
        <div
          className={`workspace${sidebarPosition === "right" ? " sidebar-right" : ""}${sidebarVisible ? "" : " sidebar-hidden"}`}
          style={{ "--sidebar-w": `${sidebarWidth}px` } as React.CSSProperties}
        >
          <ActivityBar />
          {/* One sidebar per window, bound to the focused pane: no pane
              provider wraps it, so useProjectTab() inside falls back to
              activeTabId. */}
          <Sidebar />
          {/* Draggable splitter at the sidebar<->panes border (absolutely
              positioned over it); only meaningful while the sidebar shows. */}
          {sidebarVisible && <SidebarResizer />}
          {/* An IDE-level page (Settings/Usage, tabs in the project strip)
              replaces the panes area while shown; terminals relocate to the
              keep-alive (ptys survive, as with any layout change). */}
          {appPage === "settings" ? (
            <div className="app-page">
              <SettingsTab />
            </div>
          ) : appPage === "usage" ? (
            <div className="app-page">
              <UsageTab />
            </div>
          ) : appPage === "overview" && overviewRoot ? (
            <div className="app-page">
              {/* Tabs OFF: the Overview is a chip-less sub-page, so give it a
                  Back button home (tabs ON has the chip to close instead). */}
              {!openProjectsAsTabs && (
                <div className="app-page-bar">
                  <button
                    type="button"
                    className="app-page-back"
                    onClick={() =>
                      useApp.getState().closeOverview(overviewRoot)
                    }
                  >
                    <i className="codicon codicon-arrow-left" />
                    Back
                  </button>
                </div>
              )}
              <OverviewTab root={overviewRoot} />
            </div>
          ) : showSplit && split ? (
            <div className="project-split">
              <ProjectPane tabId={split.a} focused={activeTabId === split.a} />
              <ProjectPane tabId={split.b} focused={activeTabId === split.b} />
            </div>
          ) : (
            <ProjectPane tabId={activeTabId} focused />
          )}
        </div>
        {/* Mounted ONCE here (NOT inside a pane): it portals every tab's
            terminals into the pane that currently holds that tab, so the ptys
            survive split toggles / focus swaps / tab switches. */}
        <TerminalManager />
        <StatusBar />
        {(modal === "add-secret" ||
          (typeof modal === "object" &&
            modal !== null &&
            ("requestSecret" in modal || "update" in modal))) && (
          <SecretModal
            key={
              typeof modal === "string"
                ? modal
                : "requestSecret" in modal
                  ? modal.requestSecret.requestId
                  : modal.update
            }
          />
        )}
        {typeof modal === "object" &&
          modal !== null &&
          "grantTerminal" in modal && (
            <TerminalGrantModal key={modal.grantTerminal.requestId} />
          )}
        {modal === "connect-neon" && <NeonConnectModal />}
        {modal === "add-database" && <AddDatabaseModal />}
        {modal === "connect-render" && <RenderConnectModal />}
        <Palette />
        {searchOpen && <SearchPanel />}
        <ReferencesPanel />
      </div>
    </TerminalSlotsProvider>
  );
}
