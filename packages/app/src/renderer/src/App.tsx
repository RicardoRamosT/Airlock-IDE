import { Sidebar } from "./components/Sidebar";
import { TerminalPane } from "./components/TerminalPane";
import { Viewer } from "./components/Viewer";
import { useApp } from "./store";

export function App() {
  const root = useApp((s) => s.root);
  return (
    <div className="layout">
      <Sidebar />
      <main className="editor">
        <Viewer />
      </main>
      <div className="right">
        <div className="agent-pane">
          <div className="empty">agent arrives in week 3</div>
        </div>
        <div className="terminal-slot">
          <TerminalPane key={root ?? "no-workspace"} />
        </div>
      </div>
    </div>
  );
}
