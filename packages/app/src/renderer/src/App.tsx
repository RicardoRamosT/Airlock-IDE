import { SecretModal } from "./components/SecretModal";
import { Sidebar } from "./components/Sidebar";
import { TerminalPane } from "./components/TerminalPane";
import { Viewer } from "./components/Viewer";
import { useApp } from "./store";

export function App() {
  const root = useApp((s) => s.root);
  const selectedFile = useApp((s) => s.selectedFile);
  const diff = useApp((s) => s.diff);
  const termNonce = useApp((s) => s.termNonce);
  const modal = useApp((s) => s.modal);
  return (
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
      {modal !== null && (
        <SecretModal key={typeof modal === "string" ? modal : modal.update} />
      )}
    </div>
  );
}
