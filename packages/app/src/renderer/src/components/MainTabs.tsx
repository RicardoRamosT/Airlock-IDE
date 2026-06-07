import { useEffect, useState } from "react";
import { closeEditorFile, openEditorFile } from "../lib/editorFiles";
import { EMPTY_TAB_TERMINALS, type PaneItem, useApp } from "../store";

const EMPTY_FILES: string[] = [];
const fileName = (relPath: string): string =>
  relPath.split("/").pop() ?? relPath;

// The unified main-area tab bar: every terminal AND every open file as tabs in
// one row. Clicking a tab makes it the PRIMARY (single pane). Right-click ->
// "Split" pairs the current primary (left) with that tab (right) -- any combo:
// term|term, file|file, file|term. Rendered in ProjectPane (NOT portaled).
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
  const mainSecondary = useApp((s) => s.tabState[tabId]?.mainSecondary ?? null);
  const addTerminal = useApp((s) => s.addTerminal);
  const setActiveTerminal = useApp((s) => s.setActiveTerminal);
  const removeTerminal = useApp((s) => s.removeTerminal);
  const setTerminalTitle = useApp((s) => s.setTerminalTitle);
  const setMainPrimary = useApp((s) => s.setMainPrimary);
  const splitWith = useApp((s) => s.splitWith);
  const unsplit = useApp((s) => s.unsplit);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
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

  const split = mainSecondary !== null;

  // A tab is "active" when it occupies a visible pane (primary or secondary).
  const termActive = (id: string) =>
    (mainPrimary === "terminal" && id === activeTerminalId) ||
    (mainSecondary?.kind === "terminal" && mainSecondary.id === id);
  const fileActive = (p: string) =>
    (mainPrimary === "editor" && p === selectedFile) ||
    (mainSecondary?.kind === "file" && mainSecondary.path === p);

  // Whether a tab is the current PRIMARY (so "Split" with it splits-with-new).
  const isPrimaryItem = (item: PaneItem) =>
    item.kind === "terminal"
      ? mainPrimary === "terminal" && item.id === activeTerminalId
      : mainPrimary === "editor" && item.path === selectedFile;

  // Show a terminal as the sole/primary content (setMainPrimary collapses split).
  const showTerminal = (id: string) => {
    setActiveTerminal(id, tabId);
    setMainPrimary("terminal", tabId);
  };
  const killTerminal = (id: string) => {
    const entry = terminals.find((t) => t.id === id);
    if (entry?.ptyId) window.airlock.ptyKill(entry.ptyId);
    removeTerminal(id);
  };
  // Add a new terminal WITHOUT collapsing the layout. It lands in the pane that
  // holds a terminal: the PRIMARY when the primary is a terminal (addTerminal
  // makes the new one active, which fills that slot -- the other pane is left
  // untouched), otherwise the SECONDARY beside a file primary. With no split it
  // becomes the single primary pane. The bug was clearing the secondary here
  // (and pointing it at the just-activated id, which made both panes resolve to
  // the same terminal and collapse) -- so we must NOT touch the secondary when
  // the primary is already a terminal.
  const newTerminal = () => {
    const id = addTerminal(tabId);
    if (!split) setMainPrimary("terminal", tabId);
    else if (mainPrimary === "editor")
      splitWith({ kind: "terminal", id }, tabId);
  };
  // Toolbar "split with a new terminal": always end up [current primary | new
  // terminal], never collapse. Already split -> add beside (same as newTerminal).
  // Single -> force the split, keeping the current primary terminal active so the
  // two panes stay distinct (else primary === secondary === the new terminal).
  const splitWithNewTerminal = () => {
    if (split) {
      newTerminal();
      return;
    }
    const keepActive = mainPrimary === "terminal" ? activeTerminalId : null;
    const id = addTerminal(tabId);
    splitWith({ kind: "terminal", id }, tabId);
    if (keepActive && keepActive !== id) setActiveTerminal(keepActive, tabId);
  };
  // Split the current primary (left) with `item` (right). Splitting a tab with
  // itself is impossible (a terminal can't be in two panes), so fall back to a
  // new terminal as the secondary.
  const splitPrimaryWith = (item: PaneItem) => {
    if (isPrimaryItem(item)) {
      splitWith({ kind: "terminal", id: addTerminal(tabId) }, tabId);
    } else {
      splitWith(item, tabId);
    }
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
    if (selectedFile !== keepPath) await openEditorFile(tabId, keepPath);
    for (const p of useApp.getState().tabState[tabId]?.editorTabs ?? []) {
      if (p !== keepPath) useApp.getState().closeEditorTab(p, tabId);
    }
  };
  const menuItem = (): PaneItem | null =>
    menu == null
      ? null
      : menu.kind === "terminal"
        ? { kind: "terminal", id: menu.id }
        : { kind: "file", path: menu.path };

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
        {/* Two distinct actions, never a toggle: splitting always ADDS a pane
            (so "give me a terminal beside" never collapses what you have), and
            unsplit is its own button, shown only while split. */}
        {split && (
          <button
            type="button"
            className="main-tab-action"
            title="Single pane (unsplit)"
            onClick={() => unsplit(tabId)}
          >
            <i className="codicon codicon-screen-normal" />
          </button>
        )}
        <button
          type="button"
          className="main-tab-action"
          title="Split with a new terminal"
          onClick={splitWithNewTerminal}
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
                const item = menuItem();
                if (item) splitPrimaryWith(item);
                setMenu(null);
              }}
            >
              <span>Split (open beside current)</span>
            </button>
            {split && (
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  unsplit(tabId);
                  setMenu(null);
                }}
              >
                <span>Unsplit</span>
              </button>
            )}
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
