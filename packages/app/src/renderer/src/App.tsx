import { NeonConnectModal } from "./components/NeonConnectModal";
import { Palette } from "./components/Palette";
import { ProjectPane } from "./components/ProjectPane";
import { ProjectTabs } from "./components/ProjectTabs";
import { RenderConnectModal } from "./components/RenderConnectModal";
import { SecretModal } from "./components/SecretModal";
import { StatusBar } from "./components/StatusBar";
import { TerminalManager } from "./components/TerminalManager";
import { TitleBar } from "./components/TitleBar";
import { TerminalSlotsProvider } from "./lib/terminalSlots";
import { useAgentCommands } from "./lib/useAgentCommands";
import { useFsWatch } from "./lib/useFsWatch";
import { useGitStatus } from "./lib/useGitStatus";
import { useMenuActions } from "./lib/useMenuActions";
import { usePrefs } from "./lib/usePrefs";
import { useApp } from "./store";

export function App() {
  useGitStatus();
  usePrefs();
  useMenuActions();
  useAgentCommands();
  useFsWatch();
  const modal = useApp((s) => s.modal);
  const activeTabId = useApp((s) => s.activeTabId);
  const split = useApp((s) => s.split);
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
        {showSplit && split ? (
          <div className="project-split">
            <ProjectPane tabId={split.a} focused={activeTabId === split.a} />
            <ProjectPane tabId={split.b} focused={activeTabId === split.b} />
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
        <Palette />
      </div>
    </TerminalSlotsProvider>
  );
}
