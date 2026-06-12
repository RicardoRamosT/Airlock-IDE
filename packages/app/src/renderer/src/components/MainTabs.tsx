import { useEffect, useState } from "react";
import { closeEditorFile, openEditorFile } from "../lib/editorFiles";
import {
  EMPTY_TAB_TERMINALS,
  type PaneItem,
  samePaneItem,
  useApp,
} from "../store";
import { FileIcon } from "./FileIcon";

const EMPTY_FILES: string[] = [];
const EMPTY_ORDER: PaneItem[] = [];
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
  const current = useApp((s) => s.tabState[tabId]?.current ?? null);
  const mainTabOrder = useApp(
    (s) => s.tabState[tabId]?.mainTabOrder ?? EMPTY_ORDER,
  );
  const addTerminal = useApp((s) => s.addTerminal);
  const defaultTerminal = useApp((s) => s.defaultTerminal);
  const openExternalTerminal = useApp((s) => s.openExternalTerminal);
  const removeTerminal = useApp((s) => s.removeTerminal);
  const setTerminalTitle = useApp((s) => s.setTerminalTitle);
  const viewItem = useApp((s) => s.viewItem);
  const splitItems = useApp((s) => s.splitItems);
  const unsplitCurrent = useApp((s) => s.unsplitCurrent);
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

  // The 2-pane split is on screen (vs a single pane). The toolbar button toggles
  // on this: showing the split -> Unsplit; showing a single pane -> Split.
  const showingSplit = mainSecondary !== null;

  // A tab is "active" (highlighted) when it is in the SHOWN scene: the primary
  // pane (the active terminal / selected file) or the secondary pane.
  const termActive = (id: string) =>
    (mainPrimary === "terminal" && id === activeTerminalId) ||
    (mainSecondary?.kind === "terminal" && mainSecondary.id === id);
  const fileActive = (p: string) =>
    (mainPrimary === "editor" && p === selectedFile) ||
    (mainSecondary?.kind === "file" && mainSecondary.path === p);

  const killTerminal = (id: string) => {
    const entry = terminals.find((t) => t.id === id);
    if (entry?.ptyId) window.airlock.ptyKill(entry.ptyId);
    removeTerminal(id);
  };
  // Scene model: clicking a tab FOCUSES it -- the main area shows its split (if
  // it is in one) or itself alone. It never destroys another scene's split.
  const viewTerminal = (id: string) =>
    viewItem({ kind: "terminal", id }, tabId);
  const viewFile = (p: string) => viewItem({ kind: "file", path: p }, tabId);
  // "+" -> a new terminal, shown alone; every existing split stays intact.
  const newTerminal = () => {
    if (defaultTerminal === "airlock") addTerminal(tabId);
    else openExternalTerminal(tabId);
  };
  // Toolbar "split": pair the FOCUSED tab with a new terminal (only reachable
  // when a single pane is showing). With nothing focused, just add a terminal.
  const splitWithNewTerminal = () => {
    if (!current) {
      addTerminal(tabId);
      return;
    }
    splitItems(current, { kind: "terminal", id: addTerminal(tabId) }, tabId);
  };
  // Right-click "Split (open beside current)": pair the focused tab with the
  // clicked one (a fresh terminal if you clicked the focused tab itself).
  const splitPrimaryWith = (item: PaneItem) => {
    if (!current) return;
    const secondary = samePaneItem(current, item)
      ? { kind: "terminal" as const, id: addTerminal(tabId) }
      : item;
    splitItems(current, secondary, tabId);
  };
  const closeOtherTerminals = (keepId: string) => {
    viewItem({ kind: "terminal", id: keepId }, tabId);
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

  // The left-to-right tab order: mainTabOrder, but defensively reconciled with
  // the live terminal/file membership so a tab can never vanish (drop stale
  // entries; append anything not yet ordered -- e.g. a tab opened before this
  // ordering existed -- at the end).
  const termIds = new Set(terminals.map((t) => t.id));
  const fileSet = new Set(editorTabs);
  const kept = mainTabOrder.filter((it) =>
    it.kind === "terminal" ? termIds.has(it.id) : fileSet.has(it.path),
  );
  const seenT = new Set(
    kept.flatMap((it) => (it.kind === "terminal" ? [it.id] : [])),
  );
  const seenF = new Set(
    kept.flatMap((it) => (it.kind === "file" ? [it.path] : [])),
  );
  const orderedTabs: PaneItem[] = [
    ...kept,
    ...terminals
      .filter((t) => !seenT.has(t.id))
      .map((t) => ({ kind: "terminal" as const, id: t.id })),
    ...editorTabs
      .filter((p) => !seenF.has(p))
      .map((p) => ({ kind: "file" as const, path: p })),
  ];

  const renderTerminalTab = (t: (typeof terminals)[number]) => (
    <div key={t.id} className={`main-tab${termActive(t.id) ? " active" : ""}`}>
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
          onClick={() => viewTerminal(t.id)}
          onDoubleClick={() => {
            setRenaming(t.id);
            setDraft(t.title);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, kind: "terminal", id: t.id });
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
  );

  const renderFileTab = (p: string) => (
    <div key={`f:${p}`} className={`main-tab${fileActive(p) ? " active" : ""}`}>
      <button
        type="button"
        className="main-tab-label"
        onClick={() => viewFile(p)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, kind: "file", path: p });
        }}
        title={p}
      >
        <FileIcon name={fileName(p)} />
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
  );

  const renderTab = (item: PaneItem) => {
    if (item.kind === "terminal") {
      const t = terminals.find((x) => x.id === item.id);
      return t ? renderTerminalTab(t) : null;
    }
    return renderFileTab(item.path);
  };

  return (
    <div className="main-tabs">
      <div className="main-tabs-list">
        {orderedTabs.map(renderTab)}
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
        {/* One button, toggling on what is ON SCREEN: a 2-pane split shows
            Unsplit; a single pane shows Split-with-a-new-terminal. Splitting
            pairs the FOCUSED tab with a new terminal as a new coexisting split;
            unsplit breaks only the split you are looking at. */}
        {showingSplit ? (
          <button
            type="button"
            className="main-tab-action"
            title="Single pane (unsplit)"
            onClick={() => unsplitCurrent(tabId)}
          >
            <i className="codicon codicon-screen-normal" />
          </button>
        ) : (
          <button
            type="button"
            className="main-tab-action"
            title="Split with a new terminal"
            onClick={splitWithNewTerminal}
          >
            <i className="codicon codicon-split-horizontal" />
          </button>
        )}
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
            {showingSplit && (
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  unsplitCurrent(tabId);
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
