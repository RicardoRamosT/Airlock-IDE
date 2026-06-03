import { Sidebar } from "./components/Sidebar";
import { useApp } from "./store";

export function App() {
  const selectedFile = useApp((s) => s.selectedFile);
  return (
    <div className="layout">
      <Sidebar />
      <main className="editor">
        <div className="empty">{selectedFile ?? "select a file"}</div>
      </main>
      <div className="right">
        <div className="agent-pane">
          <div className="empty">agent arrives in week 3</div>
        </div>
        <div className="terminal-slot">
          <div className="empty">terminal arrives in task 9</div>
        </div>
      </div>
    </div>
  );
}
