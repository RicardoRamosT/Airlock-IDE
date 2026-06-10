import { ActivityBar } from "./components/ActivityBar";
import { NeonConnectModal } from "./components/NeonConnectModal";
import { Palette } from "./components/Palette";
import { ProjectPane } from "./components/ProjectPane";
import { ProjectTabs } from "./components/ProjectTabs";
import { RenderConnectModal } from "./components/RenderConnectModal";
import { SearchPanel } from "./components/SearchPanel";
import { SecretModal } from "./components/SecretModal";
import { SettingsTab } from "./components/SettingsTab";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TerminalManager } from "./components/TerminalManager";
import { TitleBar } from "./components/TitleBar";
import { UsageTab } from "./components/UsageTab";
import { TerminalSlotsProvider } from "./lib/terminalSlots";
import { useAgentCommands } from "./lib/useAgentCommands";
import { useFsWatch } from "./lib/useFsWatch";
import { useGitStatus } from "./lib/useGitStatus";
import { useMenuActions } from "./lib/useMenuActions";
import { usePrefs } from "./lib/usePrefs";
import { useQuota } from "./lib/useQuota";
import { useApp } from "./store";

export function App() {
  useGitStatus();
  usePrefs();
  useMenuActions();
  useAgentCommands();
  useFsWatch();
  useQuota();
  const modal = useApp((s) => s.modal);
  const activeTabId = useApp((s) => s.activeTabId);
  const searchOpen = useApp((s) => s.searchOpen);
  const split = useApp((s) => s.split);
  const sidebarVisible = useApp((s) => s.sidebarVisible);
  const sidebarPosition = useApp((s) => s.sidebarPosition);
  const appPage = useApp((s) => s.appPage);
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
        >
          <ActivityBar />
          {/* One sidebar per window, bound to the focused pane: no pane
              provider wraps it, so useProjectTab() inside falls back to
              activeTabId. */}
          <Sidebar />
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
          (typeof modal === "object" && modal !== null)) && (
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
        {modal === "connect-neon" && <NeonConnectModal />}
        {modal === "connect-render" && <RenderConnectModal />}
        <Palette />
        {searchOpen && <SearchPanel />}
      </div>
    </TerminalSlotsProvider>
  );
}
