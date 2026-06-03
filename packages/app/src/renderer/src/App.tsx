import { Sidebar } from "./components/Sidebar";
import { Viewer } from "./components/Viewer";

export function App() {
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
          <div className="empty">terminal arrives in task 9</div>
        </div>
      </div>
    </div>
  );
}
