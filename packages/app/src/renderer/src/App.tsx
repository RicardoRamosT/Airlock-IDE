import { SecretModal } from "./components/SecretModal";
import { Sidebar } from "./components/Sidebar";
import { TerminalPane } from "./components/TerminalPane";
import { Viewer } from "./components/Viewer";
import { useApp } from "./store";

export function App() {
  const root = useApp((s) => s.root);
  const selectedFile = useApp((s) => s.selectedFile);
  const termNonce = useApp((s) => s.termNonce);
  return (
    <div className="layout">
      <Sidebar />
      <div className={`main${selectedFile ? " split" : ""}`}>
        <div className="viewer-pane">
          <Viewer />
        </div>
        <div className="terminal-slot">
          <TerminalPane key={`${root ?? "no-workspace"}:${termNonce}`} />
        </div>
      </div>
      <SecretModal />
    </div>
  );
}
