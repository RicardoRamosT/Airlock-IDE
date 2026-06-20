import { type DragEvent, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { reorderNames } from "../lib/fileOrder";
import { dropPlace, reconcileOrder, stripLiveKeys } from "../lib/stripOrder";
import { useApp } from "../store";

// Label for a tab: its folder basename, or "New Tab" for a blank tab.
const tabLabel = (root: string | null): string =>
  root ? (root.split("/").pop() ?? root) : "New Tab";

// Inline tab-rename input (swapped in for the label). Mirrors FileTree's
// inline-edit shape, EXCEPT blur COMMITS here (FileTree cancels on blur
// because its commit is an async fs IPC; this one is instant, display-only,
// and an empty commit just resets). The `done` ref makes commit fire exactly
// once: Enter also blurs on unmount, and Escape must beat the unmount blur.
function TabRenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit(value);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <input
        ref={ref}
        className="tab-rename-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            done.current = true;
            onCancel();
          }
        }}
        spellCheck={false}
      />
    </form>
  );
}

// The project-tab strip (Chrome-style). One tab per project (or blank tab).
// A SPLIT pair renders as ONE combined tab (both names) -- you switch to it as a
// unit; clicking it shows the two panes side by side, clicking any other tab
// shows that project alone (the pair persists in the strip and returns when you
// click it again -- see store: the split shows iff the focused tab is a pair
// member). The trailing + opens a blank tab; the split toggle sits far right
// (above the terminal split button) and splits the active project with a new
// blank pane (or un-splits). Right-click a tab -> "Split" pairs it with the
// active project (active = left/primary, right-clicked = right/secondary).
//
// Every entry (project tabs, the split pair, and the Settings/Usage/Overview
// page-tabs) is drag-to-reorder: the left-to-right order is `stripOrder`, a
// reconciled list of entry keys; a drop reorders it via fileOrder.reorderNames.
export function ProjectTabs() {
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const split = useApp((s) => s.split);
  const openProjectsAsTabs = useApp((s) => s.openProjectsAsTabs);
  // IDE-level page-tabs (Settings/Usage) live in this strip: they are app
  // chrome, not project content. Both may be open; appPage = the shown one.
  const appPage = useApp((s) => s.appPage);
  const settingsTabOpen = useApp((s) => s.settingsTabOpen);
  const usageTabOpen = useApp((s) => s.usageTabOpen);
  const overviewTabOpen = useApp((s) => s.overviewTabOpen);
  const overviewRoot = useApp((s) => s.overviewRoot);
  const stripOrder = useApp((s) => s.stripOrder);
  // Per-tab Claude status: the dot color is DERIVED per tab (any of its
  // terminals' ptyIds working in sessionWorking); the glow is the stored flag.
  // Shallow-compared so the strip re-renders only when a dot actually flips --
  // NOT on the ~10Hz title-spinner churn Claude writes into tabTerminals. The
  // old whole-map subscription re-rendered the entire strip on every title
  // frame; with many active sessions that was O(N^2) main-thread work and froze
  // the app (beachball with ~7 active project tabs).
  const workingByTab = useApp(
    useShallow((s) => {
      const out: Record<string, boolean> = {};
      for (const [tabId, tt] of Object.entries(s.tabTerminals)) {
        out[tabId] = tt.terminals.some(
          (t) => t.ptyId !== null && s.sessionWorking[t.ptyId] === true,
        );
      }
      return out;
    }),
  );
  const tabGlow = useApp((s) => s.tabGlow);
  const tabRenames = useApp((s) => s.tabRenames);
  // The tab currently being renamed inline (null = none).
  const [renaming, setRenaming] = useState<string | null>(null);
  // Display label: the custom rename when set, else the folder basename.
  const displayLabel = (tab: { id: string; root: string | null }): string =>
    tabRenames[tab.id] ?? tabLabel(tab.root);
  // Right-click "Split" context menu (a renderer popup, mirroring Sidebar's).
  // Right-click context menu. A "tab" menu (single tab) offers Split; a "pair"
  // menu (the unified split tab) offers Unsplit + Close both.
  const [menu, setMenu] = useState<
    | { x: number; y: number; kind: "tab"; tabId: string }
    | { x: number; y: number; kind: "pair" }
    | null
  >(null);
  // Drag-to-reorder state: the key being dragged (a ref, so the drag start
  // forces no re-render) and the current drop target + side (state, which drives
  // the drop indicator).
  const dragKey = useRef<string | null>(null);
  const [over, setOver] = useState<{
    key: string;
    place: "before" | "after";
  } | null>(null);
  // Close BOTH members of the split pair (the unified tab's X / "Close both").
  // Capture the ids first: closeTab(a) dissolves the split (s.split becomes
  // null), so read both before closing; closeTab promotes/cleans up each tab.
  const closePair = () => {
    const s = useApp.getState();
    if (!s.split) return;
    const { a, b } = s.split;
    s.closeTab(a);
    s.closeTab(b);
  };
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  // Render gate: show the strip in tabs mode, while >1 tab exists, or while an
  // IDE page-tab is open (it has nowhere else to live). When hidden, returning
  // null collapses App.tsx's auto-sized grid row.
  if (
    !openProjectsAsTabs &&
    tabs.length <= 1 &&
    !settingsTabOpen &&
    !usageTabOpen &&
    !overviewTabOpen
  )
    return null;

  const splitShowing =
    split !== null && (activeTabId === split.a || activeTabId === split.b);
  // While an IDE page is shown, IT is the selected tab -- project tabs drop
  // their active highlight (their state is untouched underneath).
  const projectActive = (tabId: string) =>
    appPage === null && tabId === activeTabId;
  const isWorking = (tabId: string): boolean => workingByTab[tabId] ?? false;

  // The strip's left-to-right order: stripOrder reconciled against the live
  // entry keys (stale dropped, new appended), so an entry can never vanish.
  const orderedKeys = reconcileOrder(
    stripOrder,
    stripLiveKeys(tabs, split, {
      settings: settingsTabOpen,
      usage: usageTabOpen,
      overview: overviewTabOpen,
    }),
  );

  // --- Drag-to-reorder wiring (one group: every strip entry is interchangeable).
  const clearDrag = () => {
    dragKey.current = null;
    setOver(null);
  };
  // Drag SOURCE goes on the tab's LABEL BUTTON (not the container): a draggable
  // <div> does NOT start a drag when you grab a <button> child in Chromium, so
  // the source must be the button you actually grab (mirrors FileTree).
  const dragSource = (key: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      dragKey.current = key;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", key);
      // Ghost the FULL tab (the container), not just the label button the drag
      // started on; offset by the grab point so it tracks under the cursor.
      const tab = e.currentTarget.closest<HTMLElement>(".project-tab");
      if (tab) {
        const r = tab.getBoundingClientRect();
        e.dataTransfer.setDragImage(tab, e.clientX - r.left, e.clientY - r.top);
      }
    },
    onDragEnd: clearDrag,
  });
  // Drop TARGET stays on the container <div> so the whole tab is a drop zone
  // (dragover bubbles up from the label/close buttons); its rect drives before/after.
  const dropTarget = (key: string) => ({
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      const dk = dragKey.current;
      if (!dk || dk === key) return;
      e.preventDefault();
      setOver({
        key,
        place: dropPlace(e.currentTarget.getBoundingClientRect(), e.clientX),
      });
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const dk = dragKey.current;
      if (dk && dk !== key)
        useApp
          .getState()
          .setStripOrder(
            reorderNames(
              orderedKeys,
              dk,
              key,
              dropPlace(e.currentTarget.getBoundingClientRect(), e.clientX),
            ),
          );
      clearDrag();
    },
  });
  const dropClass = (key: string): string =>
    over?.key === key ? ` project-tab--drop-${over.place}` : "";

  // The split pair: ONE combined entry (both names), dragged/reordered as a unit.
  const renderPair = () => {
    if (!split) return null;
    const pair = split;
    const tabA = tabs.find((t) => t.id === pair.a);
    const tabB = tabs.find((t) => t.id === pair.b);
    const working = isWorking(pair.a) || isWorking(pair.b);
    // Never glow while working: busy (yellow dot) takes priority over the
    // finished-glow, matching the single-tab store invariant.
    const glow =
      !working && (tabGlow[pair.a] === true || tabGlow[pair.b] === true);
    const labelA = tabA ? displayLabel(tabA) : tabLabel(null);
    const labelB = tabB ? displayLabel(tabB) : tabLabel(null);
    return (
      <div
        key="__split__"
        className={`project-tab project-tab-pair${splitShowing && appPage === null ? " active" : ""}${glow ? " glow" : ""}${dropClass("pair")}`}
        {...dropTarget("pair")}
      >
        <button
          type="button"
          className="project-tab-label"
          {...dragSource("pair")}
          // Show the split (focus the left member) unless already in it,
          // so re-clicking does not steal focus from the right pane.
          onClick={() => {
            if (activeTabId !== pair.a && activeTabId !== pair.b)
              useApp.getState().switchTab(pair.a);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, kind: "pair" });
          }}
          title={`${labelA}  +  ${labelB} (split)`}
        >
          <span className={`project-tab-status${working ? " working" : ""}`} />
          <i className="codicon codicon-split-horizontal" />
          <span className="project-tab-title">
            {labelA}
            <span className="project-tab-pair-sep">+</span>
            {labelB}
          </span>
        </button>
        <button
          type="button"
          className="project-tab-overview"
          title="Project overview"
          onClick={(e) => {
            e.stopPropagation();
            const st = useApp.getState();
            const r = st.tabState[pair.a]?.root;
            if (r) st.openOverviewPage(r);
          }}
        >
          !
        </button>
        <button
          type="button"
          className="project-tab-close"
          title="Close both tabs"
          onClick={(e) => {
            e.stopPropagation();
            closePair();
          }}
        >
          <i className="codicon codicon-close" />
        </button>
      </div>
    );
  };

  // A normal single project (or blank) tab.
  const renderSingle = (tab: { id: string; root: string | null }) => {
    const active = projectActive(tab.id);
    const working = isWorking(tab.id);
    const glow = !working && tabGlow[tab.id] === true;
    return (
      <div
        key={tab.id}
        className={`project-tab${active ? " active" : ""}${glow ? " glow" : ""}${dropClass(tab.id)}`}
        {...dropTarget(tab.id)}
      >
        {renaming === tab.id ? (
          <span className="project-tab-label">
            <span
              className={`project-tab-status${working ? " working" : ""}`}
            />
            <i className="codicon codicon-folder" />
            <TabRenameInput
              initial={displayLabel(tab)}
              onCommit={(name) => {
                useApp.getState().renameTab(tab.id, name);
                setRenaming(null);
              }}
              onCancel={() => setRenaming(null)}
            />
          </span>
        ) : (
          <button
            type="button"
            className="project-tab-label"
            {...dragSource(tab.id)}
            onClick={() => useApp.getState().switchTab(tab.id)}
            onDoubleClick={() => setRenaming(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({
                x: e.clientX,
                y: e.clientY,
                kind: "tab",
                tabId: tab.id,
              });
            }}
            title={tab.root ?? "New Tab"}
          >
            <span
              className={`project-tab-status${working ? " working" : ""}`}
            />
            <i className="codicon codicon-folder" />
            <span className="project-tab-title">{displayLabel(tab)}</span>
          </button>
        )}
        {tab.root && (
          <button
            type="button"
            className="project-tab-overview"
            title="Project overview"
            onClick={(e) => {
              e.stopPropagation();
              if (tab.root) useApp.getState().openOverviewPage(tab.root);
            }}
          >
            !
          </button>
        )}
        <button
          type="button"
          className="project-tab-close"
          title="Close project"
          onClick={(e) => {
            e.stopPropagation();
            useApp.getState().closeTab(tab.id);
          }}
        >
          <i className="codicon codicon-close" />
        </button>
      </div>
    );
  };

  // An IDE-level page-tab (Settings / Usage / Overview).
  const PAGE_META = {
    settings: { icon: "gear", title: "Settings", label: "Settings" },
    usage: { icon: "graph", title: "Usage", label: "Usage" },
    overview: {
      icon: "info",
      title: overviewRoot ? `Overview — ${overviewRoot}` : "Overview",
      label: overviewRoot
        ? (overviewRoot.split("/").pop() ?? "Overview")
        : "Overview",
    },
  } as const;
  const renderPage = (kind: "settings" | "usage" | "overview") => {
    const m = PAGE_META[kind];
    return (
      <div
        key={`page:${kind}`}
        className={`project-tab page-tab${appPage === kind ? " active" : ""}${dropClass(`page:${kind}`)}`}
        {...dropTarget(`page:${kind}`)}
      >
        <button
          type="button"
          className="project-tab-label"
          {...dragSource(`page:${kind}`)}
          title={m.title}
          onClick={() => useApp.getState().showAppPage(kind)}
        >
          <i className={`codicon codicon-${m.icon}`} />
          <span className="project-tab-title">{m.label}</span>
        </button>
        <button
          type="button"
          className="project-tab-close"
          title={`Close ${kind}`}
          onClick={(e) => {
            e.stopPropagation();
            useApp.getState().closeAppPage(kind);
          }}
        >
          <i className="codicon codicon-close" />
        </button>
      </div>
    );
  };

  const renderEntry = (key: string) => {
    if (key === "pair") return renderPair();
    if (key === "page:settings") return renderPage("settings");
    if (key === "page:usage") return renderPage("usage");
    if (key === "page:overview") return renderPage("overview");
    const tab = tabs.find((t) => t.id === key);
    return tab ? renderSingle(tab) : null;
  };

  return (
    <div className="project-tabs">
      <div className="project-tabs-list">{orderedKeys.map(renderEntry)}</div>
      <button
        type="button"
        className="project-tab-action"
        title="New tab"
        onClick={() => useApp.getState().openBlankTab()}
      >
        <i className="codicon codicon-add" />
      </button>
      {/* Split toggle: always visible, pushed to the FAR RIGHT (above the
          terminal split button). Splits the active project with a new blank pane,
          or un-splits when the split is showing. */}
      <button
        type="button"
        className={`project-tab-action project-split-toggle${splitShowing ? " active" : ""}`}
        title={splitShowing ? "Close split" : "Split with a new pane"}
        aria-pressed={splitShowing}
        onClick={() => useApp.getState().toggleProjectSplit()}
      >
        <i className="codicon codicon-split-horizontal" />
      </button>
      {menu && (
        <>
          <button
            type="button"
            className="popover-backdrop"
            aria-label="Close menu"
            onClick={() => setMenu(null)}
          />
          <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
            {menu.kind === "tab" ? (
              <>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setRenaming(menu.tabId);
                    setMenu(null);
                  }}
                >
                  <span>Rename tab…</span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    useApp.getState().splitActiveWith(menu.tabId);
                    setMenu(null);
                  }}
                >
                  <span>Split with active project</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    useApp.getState().toggleProjectSplit();
                    setMenu(null);
                  }}
                >
                  <span>Unsplit</span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    closePair();
                    setMenu(null);
                  }}
                >
                  <span>Close both tabs</span>
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
