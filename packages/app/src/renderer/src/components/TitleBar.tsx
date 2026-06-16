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
  return (
    <header className="titlebar">
      <span className="titlebar-title">
        {project ? `AirLock - ${project}` : "AirLock"}
      </span>
      {stripHidden && activeRoot && (
        <button
          type="button"
          className="titlebar-overview"
          title="Project overview"
          onClick={() =>
            activeRoot && useApp.getState().openOverviewPage(activeRoot)
          }
        >
          !
        </button>
      )}
      <LayoutControls />
    </header>
  );
}
