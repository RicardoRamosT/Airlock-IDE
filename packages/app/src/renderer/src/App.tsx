import { DataGrid } from "./components/DataGrid";
import { SecretModal } from "./components/SecretModal";
import { SettingsTab } from "./components/SettingsTab";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TerminalManager } from "./components/TerminalManager";
import { TitleBar } from "./components/TitleBar";
import { Viewer } from "./components/Viewer";
import { useGitStatus } from "./lib/useGitStatus";
import { usePrefs } from "./lib/usePrefs";
import { useApp } from "./store";

export function App() {
  useGitStatus();
  usePrefs();
  const selectedFile = useApp((s) => s.selectedFile);
  const diff = useApp((s) => s.diff);
  const settingsOpen = useApp((s) => s.settingsOpen);
  const dbView = useApp((s) => s.dbView);
  const modal = useApp((s) => s.modal);
  const sidebarVisible = useApp((s) => s.sidebarVisible);
  const sidebarPosition = useApp((s) => s.sidebarPosition);
  return (
    <div className="app-shell">
      <TitleBar />
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
          <div className="terminal-slot">
            <TerminalManager />
          </div>
        </div>
      </div>
      <StatusBar />
      {modal !== null && (
        <SecretModal key={typeof modal === "string" ? modal : modal.update} />
      )}
    </div>
  );
}
