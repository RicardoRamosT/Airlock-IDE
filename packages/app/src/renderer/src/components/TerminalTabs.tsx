import { useState } from "react";
import { useApp } from "../store";

export function TerminalTabs() {
  const terminals = useApp((s) => s.terminals);
  const activeTerminalId = useApp((s) => s.activeTerminalId);
  const splitTerminalId = useApp((s) => s.splitTerminalId);
  const maximized = useApp((s) => s.maximized);
  const addTerminal = useApp((s) => s.addTerminal);
  const removeTerminal = useApp((s) => s.removeTerminal);
  const setActiveTerminal = useApp((s) => s.setActiveTerminal);
  const setTerminalTitle = useApp((s) => s.setTerminalTitle);
  const setSplit = useApp((s) => s.setSplit);
  const toggleMaximized = useApp((s) => s.toggleMaximized);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const kill = (id: string) => {
    const entry = terminals.find((t) => t.id === id);
    if (entry?.ptyId) window.airlock.ptyKill(entry.ptyId);
    // pty exit will removeTerminal; remove eagerly too for instant UI.
    removeTerminal(id);
  };

  const splitActive = () => {
    if (splitTerminalId) {
      setSplit(null);
      return;
    }
    const id = addTerminal();
    // addTerminal made it active; keep the previous one active, show new in split.
    if (activeTerminalId) setActiveTerminal(activeTerminalId);
    setSplit(id);
  };

  return (
    <div className="terminal-tabs">
      <div className="terminal-tabs-list">
        {terminals.map((t) => (
          <div
            key={t.id}
            className={`terminal-tab${t.id === activeTerminalId ? " active" : ""}${
              t.id === splitTerminalId ? " in-split" : ""
            }`}
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
                className="terminal-tab-label"
                onClick={() => setActiveTerminal(t.id)}
                onDoubleClick={() => {
                  setRenaming(t.id);
                  setDraft(t.title);
                }}
                title={t.title}
              >
                <i className="codicon codicon-terminal" />
                <span className="terminal-tab-title">{t.title}</span>
              </button>
            )}
            <button
              type="button"
              className="terminal-tab-close"
              title="Kill terminal"
              onClick={() => kill(t.id)}
            >
              <i className="codicon codicon-close" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="terminal-tab-action"
          title="New terminal"
          onClick={() => addTerminal()}
        >
          <i className="codicon codicon-add" />
        </button>
      </div>
      <div className="terminal-tabs-actions">
        <button
          type="button"
          className="terminal-tab-action"
          title={splitTerminalId ? "Unsplit" : "Split terminal"}
          onClick={splitActive}
        >
          <i className="codicon codicon-split-horizontal" />
        </button>
        <button
          type="button"
          className="terminal-tab-action"
          title={maximized ? "Restore layout" : "Maximize terminal"}
          onClick={toggleMaximized}
        >
          <i
            className={`codicon codicon-screen-${maximized ? "normal" : "full"}`}
          />
        </button>
      </div>
    </div>
  );
}
