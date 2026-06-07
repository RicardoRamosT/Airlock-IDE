import { useEffect, useState } from "react";
import { closeEditorFile, openEditorFile } from "../lib/editorFiles";
import {
  EMPTY_TAB_TERMINALS,
  type PaneItem,
  samePaneItem,
  useApp,
} from "../store";

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
  const mainSolo = useApp((s) => s.tabState[tabId]?.mainSolo ?? null);
  const mainTabOrder = useApp(
    (s) => s.tabState[tabId]?.mainTabOrder ?? EMPTY_ORDER,
  );
  const addTerminal = useApp((s) => s.addTerminal);
  const setActiveTerminal = useApp((s) => s.setActiveTerminal);
  const removeTerminal = useApp((s) => s.removeTerminal);
  const setTerminalTitle = useApp((s) => s.setTerminalTitle);
  const setMainPrimary = useApp((s) => s.setMainPrimary);
  const splitWith = useApp((s) => s.splitWith);
  const unsplit = useApp((s) => s.unsplit);
  const setSolo = useApp((s) => s.setSolo);
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
  // Whether the 2-pane split is the thing CURRENTLY on screen (vs a solo
  // override sitting on top of a remembered split). The toolbar button toggles
  // on this: showing the split -> Unsplit; showing a single pane -> Split.
  const showingSplit = mainSecondary !== null && mainSolo === null;

  // A tab is a MEMBER of the remembered split when it sits in the primary or
  // secondary pane (independent of any solo override). This is what "click to
  // return to the split" keys on.
  const isSplitTerminal = (id: string) =>
    (mainPrimary === "terminal" && id === activeTerminalId) ||
    (mainSecondary?.kind === "terminal" && mainSecondary.id === id);
  const isSplitFile = (p: string) =>
    (mainPrimary === "editor" && p === selectedFile) ||
    (mainSecondary?.kind === "file" && mainSecondary.path === p);

  // A tab is "active" (highlighted) when it is on SCREEN right now: the solo
  // item if one is showing, otherwise the split member(s).
  const termActive = (id: string) =>
    mainSolo
      ? mainSolo.kind === "terminal" && mainSolo.id === id
      : isSplitTerminal(id);
  const fileActive = (p: string) =>
    mainSolo ? mainSolo.kind === "file" && mainSolo.path === p : isSplitFile(p);

  // Show a terminal as the sole/primary content (collapses any split).
  const showTerminal = (id: string) => {
    setActiveTerminal(id, tabId);
    setMainPrimary("terminal", tabId);
  };
  const killTerminal = (id: string) => {
    const entry = terminals.find((t) => t.id === id);
    if (entry?.ptyId) window.airlock.ptyKill(entry.ptyId);
    removeTerminal(id);
  };
  // Scene model: clicking a terminal tab shows it WITHOUT disturbing the split.
  // With a split up, clicking a member returns to the split; clicking any other
  // terminal shows it solo (split preserved). With no split, it is the single view.
  const viewTerminal = (id: string) => {
    if (mainSecondary == null) {
      showTerminal(id);
      return;
    }
    if (isSplitTerminal(id)) setSolo(null, tabId);
    else setSolo({ kind: "terminal", id }, tabId);
  };
  // Same scene logic for files (store.openFile handles the not-yet-open case).
  const viewFile = (p: string) => {
    if (mainSecondary == null) {
      void openEditorFile(tabId, p);
      return;
    }
    if (isSplitFile(p)) setSolo(null, tabId);
    else setSolo({ kind: "file", path: p }, tabId);
  };
  // "+" -> a new terminal, shown as the current scene. With no split it is the
  // single full-screen view; with a split it is shown SOLO so the split stays
  // intact. addTerminal makes the new one active, which would hijack the split's
  // primary terminal -- so restore the primary terminal when a terminal-primary
  // split exists.
  const newTerminal = () => {
    if (mainSecondary == null) {
      showTerminal(addTerminal(tabId));
      return;
    }
    const keepPrimary = mainPrimary === "terminal" ? activeTerminalId : null;
    const id = addTerminal(tabId);
    if (keepPrimary) setActiveTerminal(keepPrimary, tabId);
    setSolo({ kind: "terminal", id }, tabId);
  };
  // The item the main area is showing RIGHT NOW (the solo override, else the
  // single primary). Splitting keys off this so you always split "what you see".
  const currentItem = (): PaneItem | null => {
    if (mainSolo) return mainSolo;
    if (mainPrimary === "terminal")
      return activeTerminalId
        ? { kind: "terminal", id: activeTerminalId }
        : null;
    return selectedFile ? { kind: "file", path: selectedFile } : null;
  };
  // Build the split [primary | secondary] where `primary` is the on-screen view.
  // A terminal primary is promoted synchronously; a file primary needs its
  // content, so drop any old split first (openFile would otherwise solo it) and
  // make it the primary editor before adding the secondary.
  const splitInto = (primary: PaneItem | null, secondary: PaneItem) => {
    if (!primary) {
      splitWith(secondary, tabId);
      return;
    }
    if (primary.kind === "terminal") {
      setActiveTerminal(primary.id, tabId);
      setMainPrimary("terminal", tabId); // primary = this terminal; clears solo
      splitWith(secondary, tabId);
      return;
    }
    // File primary. If it is ALREADY the primary editor, just add the secondary
    // (synchronous). Otherwise (a solo file, or a different file) it must be
    // promoted to the primary editor first -- which needs its content -- so drop
    // any old split (openFile would solo it instead) and load it, then split.
    if (
      !mainSolo &&
      mainPrimary === "editor" &&
      selectedFile === primary.path
    ) {
      splitWith(secondary, tabId);
      return;
    }
    unsplit(tabId);
    void openEditorFile(tabId, primary.path).then(() =>
      splitWith(secondary, tabId),
    );
  };
  // Toolbar "split": pair what you are looking at with a NEW terminal.
  const splitWithNewTerminal = () => {
    const primary = currentItem();
    splitInto(primary, { kind: "terminal", id: addTerminal(tabId) });
  };
  // Right-click "Split (open beside current)": pair the on-screen view with the
  // clicked tab. Splitting a tab with itself is impossible, so fall back to a
  // fresh terminal as the partner.
  const splitPrimaryWith = (item: PaneItem) => {
    const primary = currentItem();
    const secondary =
      primary && samePaneItem(primary, item)
        ? { kind: "terminal" as const, id: addTerminal(tabId) }
        : item;
    splitInto(primary, secondary);
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
            Unsplit; a single pane (solo or primary) shows Split-with-a-new-
            terminal. This caps the model at two panes -- you can never "2nd
            split" into an overwrite/leak -- and splits "what you see". */}
        {showingSplit ? (
          <button
            type="button"
            className="main-tab-action"
            title="Single pane (unsplit)"
            onClick={() => unsplit(tabId)}
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
