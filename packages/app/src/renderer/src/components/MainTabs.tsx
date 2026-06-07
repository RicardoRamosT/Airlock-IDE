import { useEffect, useState } from "react";
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
  // Right-click context menu (mirrors ProjectTabs): Split / Rename / Close.
  const [menu, setMenu] = useState<
    | { x: number; y: number; kind: "terminal"; id: string }
    | { x: number; y: number; kind: "file"; path: string }
    | null
  >(null);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

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
  // "Split" from the menu: make THIS tab its side, then turn the split on (when
  // already split, the menu offers the inverse and just toggles off).
  const splitFrom = () => {
    if (!menu) return;
    if (!mainSplit) {
      if (menu.kind === "terminal") showTerminal(menu.id);
      else void openEditorFile(tabId, menu.path);
    }
    toggleMainSplit(tabId);
  };
  const closeOtherTerminals = (keepId: string) => {
    setActiveTerminal(keepId, tabId);
    for (const t of terminals) {
      if (t.id === keepId) continue;
      if (t.ptyId) window.airlock.ptyKill(t.ptyId);
      removeTerminal(t.id);
    }
  };
  const closeOtherFiles = async (keepPath: string) => {
    // Keep `keepPath` active so closing the rest never disturbs the survivor.
    if (selectedFile !== keepPath) await openEditorFile(tabId, keepPath);
    for (const p of useApp.getState().tabState[tabId]?.editorTabs ?? []) {
      if (p !== keepPath) useApp.getState().closeEditorTab(p, tabId);
    }
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
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({
                    x: e.clientX,
                    y: e.clientY,
                    kind: "terminal",
                    id: t.id,
                  });
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
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, kind: "file", path: p });
              }}
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
      {menu && (
        <>
          <button
            type="button"
            className="popover-backdrop"
            aria-label="Close menu"
            onClick={() => setMenu(null)}
          />
          <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                splitFrom();
                setMenu(null);
              }}
            >
              <span>
                {mainSplit ? "Single pane" : "Split editor + terminal"}
              </span>
            </button>
            {menu.kind === "terminal" && (
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  const t = terminals.find((x) => x.id === menu.id);
                  setRenaming(menu.id);
                  setDraft(t?.title ?? "");
                  setMenu(null);
                }}
              >
                <span>Rename</span>
              </button>
            )}
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                if (menu.kind === "terminal") killTerminal(menu.id);
                else void closeEditorFile(tabId, menu.path);
                setMenu(null);
              }}
            >
              <span>Close</span>
            </button>
            {((menu.kind === "terminal" && terminals.length > 1) ||
              (menu.kind === "file" && editorTabs.length > 1)) && (
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  if (menu.kind === "terminal") closeOtherTerminals(menu.id);
                  else void closeOtherFiles(menu.path);
                  setMenu(null);
                }}
              >
                <span>Close others</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
