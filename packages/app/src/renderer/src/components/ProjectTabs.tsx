import { useApp } from "../store";

// The project-tab strip (Chrome-style). One tab per open project; clicking
// switches, the per-tab x closes, the trailing + opens a folder as a new tab.
// Switching keeps every tab's terminals running (see store: switchTab parks the
// outgoing tab's state, closeTab unmounts the closed tab's panes -> its ptys
// die). When no project is open (tabs empty) only the + shows, so there is
// always a way to open one.
export function ProjectTabs() {
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const openProjectsAsTabs = useApp((s) => s.openProjectsAsTabs);

  // Render gate: show the strip in tabs mode, or while >1 tab exists (leftover
  // tabs from a prior tabs-mode session stay navigable in windows mode). When
  // hidden, returning null collapses App.tsx's auto-sized grid row -- no layout
  // change is needed elsewhere.
  if (!openProjectsAsTabs && tabs.length <= 1) return null;

  // Mirrors Sidebar's Open Folder flow: openFolder shows the dialog + sets the
  // main window root; setRoot honors the open mode (tabs -> add a tab; windows
  // -> replace the active tab's single project in place).
  const openProject = async () => {
    try {
      const picked = await window.airlock.openFolder();
      if (picked) useApp.getState().setRoot(picked);
    } catch (err) {
      console.error("openFolder failed", err);
    }
  };

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
              title={tab.root}
            >
              <i className="codicon codicon-folder" />
              <span className="project-tab-title">
                {tab.root.split("/").pop()}
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
        title="Open project in new tab"
        onClick={openProject}
      >
        <i className="codicon codicon-add" />
      </button>
    </div>
  );
}
