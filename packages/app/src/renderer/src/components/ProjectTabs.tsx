import { useEffect, useRef, useState } from "react";
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
  // Per-tab Claude status: the dot color is DERIVED per tab (any of its
  // terminals' ptyIds working in sessionWorking); the glow is the stored flag.
  const sessionWorking = useApp((s) => s.sessionWorking);
  const tabTerminals = useApp((s) => s.tabTerminals);
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
    !usageTabOpen
  )
    return null;

  const splitShowing =
    split !== null && (activeTabId === split.a || activeTabId === split.b);
  // While an IDE page is shown, IT is the selected tab -- project tabs drop
  // their active highlight (their state is untouched underneath).
  const projectActive = (tabId: string) =>
    appPage === null && tabId === activeTabId;
  const isWorking = (tabId: string): boolean =>
    (tabTerminals[tabId]?.terminals ?? []).some(
      (t) => t.ptyId !== null && sessionWorking[t.ptyId] === true,
    );

  return (
    <div className="project-tabs">
      <div className="project-tabs-list">
        {tabs.map((tab) => {
          // The split pair is ONE combined entry, rendered at member a; member b
          // is skipped (it is shown inside the pair entry).
          if (split && tab.id === split.b) return null;
          if (split && tab.id === split.a) {
            const tabB = tabs.find((t) => t.id === split.b);
            const working = isWorking(split.a) || isWorking(split.b);
            // Never glow while working: busy (yellow dot) takes priority over the
            // finished-glow, matching the single-tab store invariant.
            const glow =
              !working &&
              (tabGlow[split.a] === true || tabGlow[split.b] === true);
            const labelA = displayLabel(tab);
            const labelB = tabB ? displayLabel(tabB) : tabLabel(null);
            const pair = split; // narrow for the click handler closure
            return (
              <div
                key="__split__"
                className={`project-tab project-tab-pair${splitShowing && appPage === null ? " active" : ""}${glow ? " glow" : ""}`}
              >
                <button
                  type="button"
                  className="project-tab-label"
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
                  <span
                    className={`project-tab-status${working ? " working" : ""}`}
                  />
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
                    st.switchTab(pair.a);
                    st.setOverviewOpen(true, pair.a);
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
          }
          // A normal single tab.
          const active = projectActive(tab.id);
          const working = isWorking(tab.id);
          const glow = !working && tabGlow[tab.id] === true;
          return (
            <div
              key={tab.id}
              className={`project-tab${active ? " active" : ""}${glow ? " glow" : ""}`}
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
              <button
                type="button"
                className="project-tab-overview"
                title="Project overview"
                onClick={(e) => {
                  e.stopPropagation();
                  const st = useApp.getState();
                  st.switchTab(tab.id);
                  st.setOverviewOpen(true, tab.id);
                }}
              >
                !
              </button>
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
        })}
        {settingsTabOpen && (
          <div
            className={`project-tab page-tab${appPage === "settings" ? " active" : ""}`}
          >
            <button
              type="button"
              className="project-tab-label"
              title="Settings"
              onClick={() => useApp.getState().showAppPage("settings")}
            >
              <i className="codicon codicon-gear" />
              <span className="project-tab-title">Settings</span>
            </button>
            <button
              type="button"
              className="project-tab-close"
              title="Close settings"
              onClick={(e) => {
                e.stopPropagation();
                useApp.getState().closeAppPage("settings");
              }}
            >
              <i className="codicon codicon-close" />
            </button>
          </div>
        )}
        {usageTabOpen && (
          <div
            className={`project-tab page-tab${appPage === "usage" ? " active" : ""}`}
          >
            <button
              type="button"
              className="project-tab-label"
              title="Usage"
              onClick={() => useApp.getState().showAppPage("usage")}
            >
              <i className="codicon codicon-graph" />
              <span className="project-tab-title">Usage</span>
            </button>
            <button
              type="button"
              className="project-tab-close"
              title="Close usage"
              onClick={(e) => {
                e.stopPropagation();
                useApp.getState().closeAppPage("usage");
              }}
            >
              <i className="codicon codicon-close" />
            </button>
          </div>
        )}
      </div>
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
