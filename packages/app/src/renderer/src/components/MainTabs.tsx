import { useState } from "react";
import { closeEditorFile, openEditorFile } from "../lib/editorFiles";
import { EMPTY_TAB_TERMINALS, useApp } from "../store";

const EMPTY_FILES: string[] = [];
const fileName = (relPath: string): string =>
  relPath.split("/").pop() ?? relPath;

// The unified main-area tab bar: every terminal AND every open file as tabs in
// one row. Clicking a tab makes it the primary content (its terminal or the file
// editor); the split toggle shows the active file editor + terminal side by
// side. Rendered in ProjectPane (NOT portaled), scoped to its pane via tabId.
export function MainTabs({ tabId }: { tabId: string }) {
  const terminals = useApp(
    (s) => (s.tabTerminals[tabId] ?? EMPTY_TAB_TERMINALS).terminals,
  );
  const activeTerminalId = useApp(
    (s) => (s.tabTerminals[tabId] ?? EMPTY_TAB_TERMINALS).activeTerminalId,
  );
  const editorTabs = useApp(
    (s) => s.tabState[tabId]?.editorTabs ?? EMPTY_FILES,
  );
  const selectedFile = useApp((s) => s.tabState[tabId]?.selectedFile ?? null);
  const mainPrimary = useApp(
    (s) => s.tabState[tabId]?.mainPrimary ?? "terminal",
  );
  const mainSplit = useApp((s) => s.tabState[tabId]?.mainSplit ?? false);
  const addTerminal = useApp((s) => s.addTerminal);
  const setActiveTerminal = useApp((s) => s.setActiveTerminal);
  const removeTerminal = useApp((s) => s.removeTerminal);
  const setTerminalTitle = useApp((s) => s.setTerminalTitle);
  const setMainPrimary = useApp((s) => s.setMainPrimary);
  const toggleMainSplit = useApp((s) => s.toggleMainSplit);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // A tab reads "active" when its content is the primary (or shown in a split).
  const termActive = (id: string) =>
    (mainPrimary === "terminal" || mainSplit) && id === activeTerminalId;
  const fileActive = (p: string) =>
    (mainPrimary === "editor" || mainSplit) && p === selectedFile;

  const showTerminal = (id: string) => {
    setActiveTerminal(id, tabId);
    setMainPrimary("terminal", tabId);
  };
  const killTerminal = (id: string) => {
    const entry = terminals.find((t) => t.id === id);
    if (entry?.ptyId) window.airlock.ptyKill(entry.ptyId);
    removeTerminal(id);
  };
  const newTerminal = () => {
    const id = addTerminal(tabId);
    setActiveTerminal(id, tabId);
    setMainPrimary("terminal", tabId);
  };

  return (
    <div className="main-tabs">
      <div className="main-tabs-list">
        {terminals.map((t) => (
          <div
            key={t.id}
            className={`main-tab${termActive(t.id) ? " active" : ""}`}
          >
            {renaming === t.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = draft.trim();
                  if (name) setTerminalTitle(t.id, name, true);
                  setRenaming(null);
                }}
              >
                <input
                  className="terminal-tab-rename"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => setRenaming(null)}
                  spellCheck={false}
                />
              </form>
            ) : (
              <button
                type="button"
                className="main-tab-label"
                onClick={() => showTerminal(t.id)}
                onDoubleClick={() => {
                  setRenaming(t.id);
                  setDraft(t.title);
                }}
                title={t.title}
              >
                <i className="codicon codicon-terminal" />
                <span className="main-tab-title">{t.title}</span>
              </button>
            )}
            <button
              type="button"
              className="main-tab-close"
              title="Kill terminal"
              onClick={() => killTerminal(t.id)}
            >
              <i className="codicon codicon-close" />
            </button>
          </div>
        ))}
        {editorTabs.map((p) => (
          <div
            key={`f:${p}`}
            className={`main-tab${fileActive(p) ? " active" : ""}`}
          >
            <button
              type="button"
              className="main-tab-label"
              onClick={() => void openEditorFile(tabId, p)}
              title={p}
            >
              <i className="codicon codicon-file" />
              <span className="main-tab-title">{fileName(p)}</span>
            </button>
            <button
              type="button"
              className="main-tab-close"
              title="Close file"
              onClick={() => void closeEditorFile(tabId, p)}
            >
              <i className="codicon codicon-close" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="main-tab-action"
          title="New terminal"
          onClick={newTerminal}
        >
          <i className="codicon codicon-add" />
        </button>
      </div>
      <div className="main-tabs-actions">
        <button
          type="button"
          className={`main-tab-action${mainSplit ? " active" : ""}`}
          title={mainSplit ? "Single pane" : "Split editor + terminal"}
          aria-pressed={mainSplit}
          onClick={() => toggleMainSplit(tabId)}
        >
          <i className="codicon codicon-split-horizontal" />
        </button>
      </div>
    </div>
  );
}
