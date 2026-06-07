import { useEffect, useState } from "react";
import { useApp } from "../store";

// Label for a tab: its folder basename, or "New Tab" for a blank tab.
const tabLabel = (root: string | null): string =>
  root ? (root.split("/").pop() ?? root) : "New Tab";

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
  // Per-tab Claude status: the dot color is DERIVED per tab (any of its
  // terminals' ptyIds working in sessionWorking); the glow is the stored flag.
  const sessionWorking = useApp((s) => s.sessionWorking);
  const tabTerminals = useApp((s) => s.tabTerminals);
  const tabGlow = useApp((s) => s.tabGlow);
  // Right-click "Split" context menu (a renderer popup, mirroring Sidebar's).
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
  } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  // Render gate: show the strip in tabs mode, or while >1 tab exists. When
  // hidden, returning null collapses App.tsx's auto-sized grid row.
  if (!openProjectsAsTabs && tabs.length <= 1) return null;

  const splitShowing =
    split !== null && (activeTabId === split.a || activeTabId === split.b);
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
            const labelA = tabLabel(tab.root);
            const labelB = tabLabel(tabB?.root ?? null);
            const pair = split; // narrow for the click handler closure
            return (
              <div
                key="__split__"
                className={`project-tab project-tab-pair${splitShowing ? " active" : ""}${glow ? " glow" : ""}`}
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
              </div>
            );
          }
          // A normal single tab.
          const active = tab.id === activeTabId;
          const working = isWorking(tab.id);
          const glow = !working && tabGlow[tab.id] === true;
          return (
            <div
              key={tab.id}
              className={`project-tab${active ? " active" : ""}${glow ? " glow" : ""}`}
            >
              <button
                type="button"
                className="project-tab-label"
                onClick={() => useApp.getState().switchTab(tab.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
                }}
                title={tab.root ?? "New Tab"}
              >
                <span
                  className={`project-tab-status${working ? " working" : ""}`}
                />
                <i className="codicon codicon-folder" />
                <span className="project-tab-title">{tabLabel(tab.root)}</span>
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
          </div>
        </>
      )}
    </div>
  );
}
