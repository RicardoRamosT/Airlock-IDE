import { SecretModal } from "./components/SecretModal";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TerminalPane } from "./components/TerminalPane";
import { TitleBar } from "./components/TitleBar";
import { Viewer } from "./components/Viewer";
import { useGitStatus } from "./lib/useGitStatus";
import { useApp } from "./store";

export function App() {
  useGitStatus();
  const root = useApp((s) => s.root);
  const selectedFile = useApp((s) => s.selectedFile);
  const diff = useApp((s) => s.diff);
  const termNonce = useApp((s) => s.termNonce);
  const modal = useApp((s) => s.modal);
  return (
    <div className="app-shell">
      <TitleBar />
      <div className="layout">
        <Sidebar />
        <div className={`main${selectedFile || diff ? " split" : ""}`}>
          <div className="viewer-pane">
            <Viewer />
          </div>
          <div className="terminal-slot">
            <TerminalPane key={`${root ?? "no-workspace"}:${termNonce}`} />
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
