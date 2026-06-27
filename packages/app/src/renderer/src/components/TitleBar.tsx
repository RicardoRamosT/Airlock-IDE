import { useState } from "react";
import { useApp } from "../store";
import { LayoutControls } from "./LayoutControls";

const basename = (root: string | null): string =>
  root ? (root.split("/").pop() ?? "") : "";

export function TitleBar() {
  const activeTabId = useApp((s) => s.activeTabId);
  const split = useApp((s) => s.split);
  const tabState = useApp((s) => s.tabState);
  const openProjectsAsTabs = useApp((s) => s.openProjectsAsTabs);
  const tabsLen = useApp((s) => s.tabs.length);
  const settingsTabOpen = useApp((s) => s.settingsTabOpen);
  const usageTabOpen = useApp((s) => s.usageTabOpen);
  // While the split is ON SCREEN (focused tab is a pair member) the title
  // names BOTH projects in pane order; otherwise just the focused project.
  const showSplit =
    split !== null && (activeTabId === split.a || activeTabId === split.b);
  const names = (
    showSplit && split
      ? [
          basename(tabState[split.a]?.root ?? null),
          basename(tabState[split.b]?.root ?? null),
        ]
      : [basename(tabState[activeTabId]?.root ?? null)]
  ).filter(Boolean);
  const project = names.join(" + ");
  // The project strip hides entirely in separate-windows mode with a single
  // project + no IDE page-tab (ProjectTabs returns null there), so the "!" has
  // no tab to live on — surface it in the always-present TitleBar instead.
  const stripHidden =
    !openProjectsAsTabs && tabsLen <= 1 && !settingsTabOpen && !usageTabOpen;
  const activeRoot = tabState[activeTabId]?.root ?? null;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const openOverview = (): void => {
    if (!activeRoot) return;
    const s = useApp.getState();
    // Tabs ON: open the Overview as a tab (a chip in the project strip).
    // Tabs OFF: just SHOW it as a sub-page (no chip) — App renders a Back
    // button so there's a way home without a tab to close.
    if (openProjectsAsTabs) s.openOverviewPage(activeRoot);
    else s.showOverview(activeRoot);
  };
  return (
    <header className="titlebar">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click affordance on the passive project-name label to open the Overview; not a focusable control (the titlebar book button + project-tab menu are the real controls) */}
      <span
        className={`titlebar-title${activeRoot ? " interactive" : ""}`}
        onContextMenu={(e) => {
          // Right-click the project name -> project-level actions (Overview).
          // The title bar is always present, so this works with zero tabs.
          if (!activeRoot) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {project ? `AirLock - ${project}` : "AirLock"}
      </span>
      {stripHidden && activeRoot && (
        <button
          type="button"
          className="titlebar-overview"
          title="Project overview"
          onClick={openOverview}
        >
          <i className="codicon codicon-book" />
        </button>
      )}
      <LayoutControls />
      {menu && activeRoot && (
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
                openOverview();
                setMenu(null);
              }}
            >
              <span>Overview</span>
            </button>
          </div>
        </>
      )}
    </header>
  );
}
