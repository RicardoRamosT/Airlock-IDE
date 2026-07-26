import { type DragEvent, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { MovingTab } from "../../../shared/ipc";
import { reorderNames } from "../lib/fileOrder";
import { dropPlace, reconcileOrder, stripLiveKeys } from "../lib/stripOrder";
import { buildMovingTab, isMovableKey } from "../lib/tabDrag";
import { useApp } from "../store";

// Title-case a folder name for display (first letter up, rest down) so tab
// labels read consistently regardless of the folder's own casing.
const titleCase = (s: string): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;

// Label for a tab: its folder basename (title-cased), or "New Tab" for a blank
// tab. Only the AUTO name is normalized -- a manual rename is shown verbatim via
// displayLabel (tabRenames), so this never overrides what the user typed.
const tabLabel = (root: string | null): string =>
  root ? titleCase(root.split("/").pop() ?? root) : "New Tab";

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

// The Overview segment of the master folder: an SVG "lower roof" (a curved
// shoulder stepping down from the master's full-height roof, then the overview
// roof + top-right corner + right side) with the label centered over it. The
// fill/outline read --tab-fill/--tab-outline so it recolors with the tab state.
// viewBox is 96x32 (preserveAspectRatio:none lets it fill the segment); D=6 drop,
// C=7 curve, R=6 corner. See the master-label styling in theme.css.
const OV_FILL = "M0 0 C3.5 0 3.5 6 7 6 L90 6 Q96 6 96 12 L96 28 L0 28 Z";
const OV_STROKE = "M0 0 C3.5 0 3.5 6 7 6 L90 6 Q96 6 96 12 L96 28";
// Rendered ONLY on the focused (master) tab. The button is a clip container over
// fixed-width inner content; a grow-in keyframe animates its width 0->96 on mount
// (when the tab gains focus) so the folder eases open without squishing the roof.
function OverviewEntry({ root }: { root: string }) {
  const active = useApp(
    (s) => s.appPage === "overview" && s.overviewRoot === root,
  );
  return (
    <button
      type="button"
      className={`project-tab-overview${active ? " active" : ""}`}
      title="Overview"
      onClick={(e) => {
        e.stopPropagation();
        useApp.getState().showOverview(root);
      }}
    >
      <span className="ov-inner">
        <svg
          className="ov-roof"
          viewBox="0 0 96 28"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path className="ov-fill" d={OV_FILL} />
          {/* Dotted diagonal separating master from Overview, matching the
              roof's visible shoulder diagonal (tuned in the mockup). */}
          <line
            className="ov-divider"
            x1="1.5"
            y1="0"
            x2="19.5"
            y2="28"
            vectorEffect="non-scaling-stroke"
          />
          <path
            className="ov-stroke"
            d={OV_STROKE}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span className="ov-text">Overview</span>
      </span>
    </button>
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
  const extensionsTabOpen = useApp((s) => s.extensionsTabOpen);
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
  // The key being dragged, as STATE (not just the dragKey ref) so the dragged
  // tab can collapse OUT of the row while dragging -- otherwise its slot stays
  // and the make-room gap opens confusingly right next to it.
  const [dragging, setDragging] = useState<string | null>(null);
  // Cross-window drag affordance for THIS window, plus this window's own id (so a
  // hover broadcast can be told apart from another window's).
  const [dragHint, setDragHint] = useState<{
    kind: "merge" | "detach";
    label: string | null;
  } | null>(null);
  const windowIdRef = useRef<number | null>(null);
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

  // Cross-window tab drag: the affordance THIS window shows, plus inbound tabs.
  // Deliberately ABOVE the render gate below, so these stay live even when the
  // strip renders null (windows mode, single tab) -- otherwise such a window could
  // never receive a torn-off tab.
  useEffect(() => {
    void window.airlock.windowId?.().then((id) => {
      windowIdRef.current = id;
    });
    const offHover = window.airlock.onTabDragHover?.((h) => {
      const me = windowIdRef.current;
      if (h.target.kind === "merge")
        setDragHint(
          h.target.windowId === me ? { kind: "merge", label: h.label } : null,
        );
      else if (h.target.kind === "detach")
        // Only the window the tab came FROM hints "release to detach".
        setDragHint(
          h.sourceWindowId === me ? { kind: "detach", label: h.label } : null,
        );
      else setDragHint(null);
    });
    const adopt = (p: MovingTab) => {
      const s = useApp.getState();
      // A window created just to receive this tab still holds the placeholder
      // blank tab it booted with; drop it so the torn-off window shows ONLY the
      // moved project.
      const lone =
        s.tabs.length === 1 && s.tabs[0]?.root === null ? s.tabs[0] : null;
      s.adoptTab(p);
      if (lone) useApp.getState().closeTab(lone.id);
    };
    // A window created for a torn-off tab CLAIMS it here, now that this component
    // is mounted and its store is ready. Pull rather than push: main cannot know
    // when React's effects have run, and a payload pushed too early would be
    // dropped -- losing a tab the source window has already let go of.
    void window.airlock.tabDragTakePending?.().then((p) => {
      if (p) adopt(p);
    });
    // Push path, for merging into a window that is already open.
    const offAdopt = window.airlock.onTabDragAdopt?.(adopt);
    return () => {
      // Type-checked before calling: a stubbed/absent subscribe (tests, an older
      // preload) returns something that is not an unsubscribe function.
      if (typeof offHover === "function") offHover();
      if (typeof offAdopt === "function") offAdopt();
    };
  }, []);

  // Render gate: show the strip in tabs mode, while >1 tab exists, or while an
  // IDE page-tab is open (it has nowhere else to live). When hidden, returning
  // null collapses App.tsx's auto-sized grid row.
  if (
    !openProjectsAsTabs &&
    tabs.length <= 1 &&
    !settingsTabOpen &&
    !usageTabOpen &&
    !extensionsTabOpen
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
      extensions: extensionsTabOpen,
    }),
  );

  // --- Drag-to-reorder wiring (one group: every strip entry is interchangeable).
  const clearDrag = () => {
    dragKey.current = null;
    setOver(null);
    setDragging(null);
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
        // Size the "make room" drop gap to the dragged tab so the slid-open slot
        // matches where it will land. Set on the list so it inherits to all tabs.
        tab.parentElement?.style.setProperty("--drop-gap", `${r.width}px`);
      }
      // Collapse the dragged tab out of the row -- but on the NEXT frame: hiding
      // the drag source synchronously inside dragstart CANCELS the drag in
      // Chromium. By the next frame the drag has latched. Skip if it already ended.
      requestAnimationFrame(() => {
        if (dragKey.current === key) setDragging(key);
      });
      // Begin the cross-window drag: main tracks the cursor and tells the windows
      // whether releasing here would reorder, merge, or detach. The tab's name goes
      // along so each window's hint can say WHICH project it is about to take.
      if (isMovableKey(key)) {
        const dragged = tabs.find((t) => t.id === key);
        void window.airlock.tabDragStart?.(
          dragged ? displayLabel(dragged) : null,
        );
      }
    },
    // Release decides the tab's fate. The payload is BUILT (not detached) and sent
    // to main, which resolves the drop; the tab only leaves this window once main
    // confirms a real move -- so an in-window reorder is a true no-op, and the
    // target window has already adopted before the source lets go (add before
    // remove, so a failed move cannot lose a tab).
    onDragEnd: () => {
      const key = dragKey.current;
      clearDrag();
      if (key === null) return;
      const s = useApp.getState();
      // A pair/page-tab never moves, and a window's last tab is already its own
      // window: null tells main to report the target and move nothing.
      const payload =
        isMovableKey(key) && s.tabs.length > 1 ? buildMovingTab(s, key) : null;
      void window.airlock
        .tabDragEnd?.(payload)
        .then((target) => {
          if (payload && target && target.kind !== "reorder")
            useApp.getState().detachTab(key);
        })
        .catch(() => {
          /* main unreachable -> keep the tab where it is */
        });
    },
  });
  // Drop TARGET (per tab) ONLY tracks the hovered insertion point (over). The
  // actual DROP is handled at the LIST level (onListDrop): the make-room gap is
  // margin OUTSIDE any tab's box, so a release over the gap would otherwise fall
  // through to empty space and not reorder. Handling drop on the list captures
  // those releases too. (drag-reorder slide fix)
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
  });
  // Allow a drop anywhere in the strip (including the opened gap / bare list
  // background) and commit it using the last hovered insertion point. Spread
  // onto the list (like dropTarget) so the a11y "static element" lint -- which
  // only sees literal handlers -- treats this drag-drop zone the same way.
  const listDropZone = {
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (dragKey.current) e.preventDefault();
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const dk = dragKey.current;
      if (dk && over && over.key !== dk)
        useApp
          .getState()
          .setStripOrder(reorderNames(orderedKeys, dk, over.key, over.place));
      clearDrag();
    },
  };
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
        className={`project-tab project-tab-pair${splitShowing && appPage === null ? " active" : ""}${splitShowing ? " folder-open" : ""}${activeTabId === pair.a || activeTabId === pair.b ? " has-overview" : ""}${working ? " working" : ""}${glow ? " glow" : ""}${dragging === "pair" ? " dragging" : ""}${dropClass("pair")}`}
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
          <i className="codicon codicon-split-horizontal" />
          <span className="project-tab-title">
            {labelA}
            <span className="project-tab-pair-sep">+</span>
            {labelB}
          </span>
        </button>
        {(() => {
          const r = tabs.find((t) => t.id === activeTabId)?.root;
          return (activeTabId === pair.a || activeTabId === pair.b) && r ? (
            <OverviewEntry root={r} />
          ) : null;
        })()}
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
        className={`project-tab${active ? " active" : ""}${tab.id === activeTabId ? " folder-open" : ""}${tab.id === activeTabId && tab.root ? " has-overview" : ""}${working ? " working" : ""}${glow ? " glow" : ""}${dragging === tab.id ? " dragging" : ""}${dropClass(tab.id)}`}
        {...dropTarget(tab.id)}
      >
        {renaming === tab.id ? (
          <span className="project-tab-label">
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
            <span className="project-tab-title">{displayLabel(tab)}</span>
          </button>
        )}
        {tab.id === activeTabId && tab.root ? (
          <OverviewEntry root={tab.root} />
        ) : null}
      </div>
    );
  };

  // A GLOBAL IDE-level page-tab (Settings / Usage). Overview is per-project and
  // rendered separately (renderOverviewPage), one chip per open root.
  const PAGE_META = {
    settings: { icon: "gear", title: "Settings", label: "Settings" },
    usage: { icon: "dashboard", title: "Usage", label: "Usage" },
    extensions: {
      icon: "extensions",
      title: "Extensions",
      label: "Extensions",
    },
  } as const;
  const renderPage = (kind: "settings" | "usage" | "extensions") => {
    const m = PAGE_META[kind];
    return (
      <div
        key={`page:${kind}`}
        className={`project-tab page-tab${appPage === kind ? " active" : ""}${dragging === `page:${kind}` ? " dragging" : ""}${dropClass(`page:${kind}`)}`}
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
    if (key === "page:extensions") return renderPage("extensions");
    const tab = tabs.find((t) => t.id === key);
    return tab ? renderSingle(tab) : null;
  };

  return (
    <div
      className={`project-tabs${dragHint ? ` tabdrag-${dragHint.kind}` : ""}`}
    >
      <div className="project-tabs-list" {...listDropZone}>
        {orderedKeys.map(renderEntry)}
      </div>
      <button
        type="button"
        className="project-tab-action"
        title="New tab"
        onClick={() => useApp.getState().openBlankTab()}
      >
        <i className="codicon codicon-add" />
      </button>
      {/* Says what releasing will DO, since the drop is what commits the move --
          without it, dragging outside gives no clue a window is coming. "Window",
          not "instance": AirLock holds a single-instance lock, so a torn-off tab
          becomes another window in the same process (which is exactly why its
          terminals survive the move). */}
      {dragHint && (
        <span className="tabdrag-hint" role="status">
          <i
            className={`codicon codicon-${
              dragHint.kind === "detach" ? "link-external" : "arrow-small-down"
            }`}
          />
          {dragHint.kind === "detach"
            ? `Release to open ${dragHint.label ?? "this project"} in a new window`
            : `Drop to add ${dragHint.label ?? "this project"} here`}
        </span>
      )}
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
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    useApp.getState().closeTab(menu.tabId);
                    setMenu(null);
                  }}
                >
                  <span>Close</span>
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
