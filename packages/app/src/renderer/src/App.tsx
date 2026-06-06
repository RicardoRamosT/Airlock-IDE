import { NeonConnectModal } from "./components/NeonConnectModal";
import { ProjectPane } from "./components/ProjectPane";
import { ProjectTabs } from "./components/ProjectTabs";
import { RenderConnectModal } from "./components/RenderConnectModal";
import { SecretModal } from "./components/SecretModal";
import { StatusBar } from "./components/StatusBar";
import { TerminalManager } from "./components/TerminalManager";
import { TitleBar } from "./components/TitleBar";
import { TerminalSlotsProvider } from "./lib/terminalSlots";
import { useGitStatus } from "./lib/useGitStatus";
import { useMenuActions } from "./lib/useMenuActions";
import { usePrefs } from "./lib/usePrefs";
import { useApp } from "./store";

export function App() {
  useGitStatus();
  usePrefs();
  useMenuActions();
  const modal = useApp((s) => s.modal);
  const activeTabId = useApp((s) => s.activeTabId);
  const splitTabId = useApp((s) => s.splitTabId);
  return (
    <TerminalSlotsProvider>
      <div className="app-shell">
        <TitleBar />
        <ProjectTabs />
        {/* The content row: one ProjectPane (single, focused -- identical to the
            pre-split layout) or two side by side when splitTabId is set. Each
            pane is a full project view scoped to its tab via ProjectPaneContext.
            The focused pane (tabId === activeTabId) is the left one and drives
            the agent / window title. */}
        {splitTabId ? (
          <div className="project-split">
            <ProjectPane tabId={activeTabId} focused />
            <ProjectPane tabId={splitTabId} focused={false} />
          </div>
        ) : (
          <ProjectPane tabId={activeTabId} focused />
        )}
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
      </div>
    </TerminalSlotsProvider>
  );
}
