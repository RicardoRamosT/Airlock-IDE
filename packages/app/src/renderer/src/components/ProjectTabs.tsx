import { useApp } from "../store";

// The project-tab strip (Chrome-style). One tab per project (or blank tab);
// clicking a tab switches to it, the per-tab x closes it, and the trailing +
// opens a fresh blank tab (no folder dialog -- the blank tab's own Open Folder
// flow attaches a project). Switching keeps every tab's terminals running (see
// store: switchTab parks the outgoing tab's state, closeTab unmounts the closed
// tab's panes -> its ptys die). The window always has >= 1 tab in tabs mode.
export function ProjectTabs() {
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const openProjectsAsTabs = useApp((s) => s.openProjectsAsTabs);

  // Render gate: show the strip in tabs mode, or while >1 tab exists (leftover
  // tabs from a prior tabs-mode session stay navigable in windows mode). When
  // hidden, returning null collapses App.tsx's auto-sized grid row -- no layout
  // change is needed elsewhere.
  if (!openProjectsAsTabs && tabs.length <= 1) return null;

  return (
    <div className="project-tabs">
      <div className="project-tabs-list">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`project-tab${tab.id === activeTabId ? " active" : ""}`}
          >
            <button
              type="button"
              className="project-tab-label"
              onClick={() => useApp.getState().switchTab(tab.id)}
              title={tab.root ?? "New Tab"}
            >
              <i className="codicon codicon-folder" />
              <span className="project-tab-title">
                {tab.root ? (tab.root.split("/").pop() ?? tab.root) : "New Tab"}
              </span>
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
        ))}
      </div>
      <button
        type="button"
        className="project-tab-action"
        title="New tab"
        onClick={() => useApp.getState().openBlankTab()}
      >
        <i className="codicon codicon-add" />
      </button>
    </div>
  );
}
