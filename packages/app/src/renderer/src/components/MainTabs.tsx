import { type DragEvent, useEffect, useRef, useState } from "react";
import { closeEditorFile, openEditorFile } from "../lib/editorFiles";
import { reorderNames } from "../lib/fileOrder";
import { dropPlace } from "../lib/stripOrder";
import {
  type DbView,
  EMPTY_TAB_TERMINALS,
  type PaneItem,
  sameDbView,
  samePaneItem,
  useApp,
} from "../store";
import { FileIcon } from "./FileIcon";

const EMPTY_FILES: string[] = [];
const EMPTY_ORDER: PaneItem[] = [];
const EMPTY_DBTABS: DbView[] = [];
const fileName = (relPath: string): string =>
  relPath.split("/").pop() ?? relPath;
// Stable React key / identity string for an open db-table tab.
const dbKey = (v: DbView): string =>
  v.kind === "secret"
    ? `s:${v.id}:${v.schema}.${v.table}`
    : `n:${v.projectId}/${v.branchId}/${v.database}/${v.role}/${v.schema}.${v.table}`;

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
  const dbTabs = useApp((s) => s.tabState[tabId]?.dbTabs ?? EMPTY_DBTABS);
  const dbView = useApp((s) => s.tabState[tabId]?.dbView ?? null);
  const setDbView = useApp((s) => s.setDbView);
  const closeDbTab = useApp((s) => s.closeDbTab);
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
  // When a db table is shown (the dbView overlay), it is the active tab -- no
  // terminal/file pane tab is highlighted underneath it.
  const termActive = (id: string) =>
    !dbView &&
    ((mainPrimary === "terminal" && id === activeTerminalId) ||
      (mainSecondary?.kind === "terminal" && mainSecondary.id === id));
  const fileActive = (p: string) =>
    !dbView &&
    ((mainPrimary === "editor" && p === selectedFile) ||
      (mainSecondary?.kind === "file" && mainSecondary.path === p));

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

  // --- Drag-to-reorder. Two independent groups in one row: content tabs
  // (terminals+files, ordered by mainTabOrder) and db-table tabs (ordered by
  // dbTabs). A drop only reorders within the dragged tab's OWN group; the array
  // math reuses fileOrder.reorderNames over per-tab string keys.
  const paneKey = (it: PaneItem): string =>
    it.kind === "terminal" ? `t:${it.id}` : `f:${it.path}`;
  const groupOf = (key: string): "db" | "content" =>
    key.startsWith("db:") ? "db" : "content";
  const dragKey = useRef<string | null>(null);
  const [over, setOver] = useState<{
    key: string;
    place: "before" | "after";
  } | null>(null);
  // The key being dragged, as STATE so the dragged tab can collapse OUT of the
  // row while dragging (else its slot stays and the make-room gap opens next to
  // it). Mirrors ProjectTabs.
  const [dragging, setDragging] = useState<string | null>(null);
  const clearDrag = () => {
    dragKey.current = null;
    setOver(null);
    setDragging(null);
  };
  const applyReorder = (dk: string, ok: string, place: "before" | "after") => {
    if (groupOf(ok) === "db") {
      const byKey = new Map<string, DbView>(
        dbTabs.map((v) => [`db:${dbKey(v)}`, v]),
      );
      const next = reorderNames([...byKey.keys()], dk, ok, place);
      useApp.getState().reorderDbTabs(
        next.map((k) => byKey.get(k)).filter((v): v is DbView => !!v),
        tabId,
      );
    } else {
      const byKey = new Map(
        orderedTabs.map((it) => [paneKey(it), it] as const),
      );
      const next = reorderNames([...byKey.keys()], dk, ok, place);
      useApp.getState().reorderMainTabs(
        next.map((k) => byKey.get(k)).filter((it): it is PaneItem => !!it),
        tabId,
      );
    }
  };
  // Drag SOURCE goes on the tab's LABEL BUTTON (not the container): a draggable
  // <div> does NOT start a drag when you grab a <button> child in Chromium, so
  // the source must be the button you actually grab (mirrors FileTree).
  const dragSource = (key: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      dragKey.current = key;
      setDragging(key); // collapse this tab out of the row while dragging
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", key);
      // Ghost the FULL tab (the container), not just the label button the drag
      // started on; offset by the grab point so it tracks under the cursor.
      const tab = e.currentTarget.closest<HTMLElement>(".main-tab");
      if (tab) {
        const r = tab.getBoundingClientRect();
        e.dataTransfer.setDragImage(tab, e.clientX - r.left, e.clientY - r.top);
        // Size the "make room" drop gap to the dragged tab so the slid-open slot
        // matches where it will land. Set on the list so it inherits to all tabs.
        tab.parentElement?.style.setProperty("--drop-gap", `${r.width}px`);
      }
    },
    onDragEnd: clearDrag,
  });
  // Drop TARGET stays on the container <div> so the whole tab is a drop zone
  // (dragover bubbles up from the label/close buttons); its rect drives before/after.
  const dropTarget = (key: string) => ({
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      const dk = dragKey.current;
      if (!dk || dk === key || groupOf(dk) !== groupOf(key)) return;
      e.preventDefault();
      setOver({
        key,
        place: dropPlace(e.currentTarget.getBoundingClientRect(), e.clientX),
      });
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const dk = dragKey.current;
      if (dk && dk !== key && groupOf(dk) === groupOf(key))
        applyReorder(
          dk,
          key,
          dropPlace(e.currentTarget.getBoundingClientRect(), e.clientX),
        );
      clearDrag();
    },
  });
  const dropClass = (key: string): string =>
    over?.key === key ? ` main-tab--drop-${over.place}` : "";

  const renderTerminalTab = (t: (typeof terminals)[number]) => (
    <div
      key={t.id}
      className={`main-tab${termActive(t.id) ? " active" : ""}${dragging === `t:${t.id}` ? " dragging" : ""}${dropClass(`t:${t.id}`)}`}
      {...dropTarget(`t:${t.id}`)}
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
          {...dragSource(`t:${t.id}`)}
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
    <div
      key={`f:${p}`}
      className={`main-tab${fileActive(p) ? " active" : ""}${dragging === `f:${p}` ? " dragging" : ""}${dropClass(`f:${p}`)}`}
      {...dropTarget(`f:${p}`)}
    >
      <button
        type="button"
        className="main-tab-label"
        {...dragSource(`f:${p}`)}
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

  // Open db tables render as persistent tabs after the terminal/file tabs.
  // Clicking shows the table (sets the dbView overlay); the x closes the tab.
  const dbActive = (v: DbView) => !!dbView && sameDbView(dbView, v);
  const renderDbTab = (v: DbView) => (
    <div
      key={dbKey(v)}
      className={`main-tab${dbActive(v) ? " active" : ""}${dragging === `db:${dbKey(v)}` ? " dragging" : ""}${dropClass(`db:${dbKey(v)}`)}`}
      {...dropTarget(`db:${dbKey(v)}`)}
    >
      <button
        type="button"
        className="main-tab-label"
        {...dragSource(`db:${dbKey(v)}`)}
        onClick={() => setDbView(v, tabId)}
        title={`${v.schema}.${v.table}`}
      >
        <i className="codicon codicon-table" />
        <span className="main-tab-title">
          {v.schema}.{v.table}
        </span>
      </button>
      <button
        type="button"
        className="main-tab-close"
        title="Close table"
        onClick={() => closeDbTab(v, tabId)}
      >
        <i className="codicon codicon-close" />
      </button>
    </div>
  );

  return (
    <div className="main-tabs">
      <div className="main-tabs-list">
        {orderedTabs.map(renderTab)}
        {dbTabs.map(renderDbTab)}
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
