import { SecretModal } from "./components/SecretModal";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TerminalManager } from "./components/TerminalManager";
import { TitleBar } from "./components/TitleBar";
import { Viewer } from "./components/Viewer";
import { useGitStatus } from "./lib/useGitStatus";
import { useApp } from "./store";

export function App() {
  useGitStatus();
  const selectedFile = useApp((s) => s.selectedFile);
  const diff = useApp((s) => s.diff);
  const modal = useApp((s) => s.modal);
  const maximized = useApp((s) => s.maximized);
  const sidebarVisible = useApp((s) => s.sidebarVisible);
  const sidebarPosition = useApp((s) => s.sidebarPosition);
  return (
    <div className={`app-shell${maximized ? " maximized" : ""}`}>
      <TitleBar />
      <div
        className={`layout${sidebarPosition === "right" ? " sidebar-right" : ""}${sidebarVisible ? "" : " sidebar-hidden"}`}
      >
        <Sidebar />
        <div className={`main${selectedFile || diff ? " split" : ""}`}>
          <div className="viewer-pane">
            <Viewer />
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
