import type { ReactNode } from "react";
import { sidebarViewFor } from "../lib/extensionViews";
import { useProjectTab } from "../lib/projectPane";
import { effectiveView, parseExtSection } from "../lib/sections";
import { useApp } from "../store";
import { ActivitySection } from "./ActivitySection";
import { AuditSection } from "./AuditSection";
import { DatabasesSection } from "./DatabasesSection";
import { EventsSection } from "./EventsSection";
import { ExtensionResourcesSection } from "./ExtensionResourcesSection";
import { FileTree } from "./FileTree";
import { GitSection } from "./GitSection";
import { LocalHostSection } from "./LocalHostSection";
import { OpenFolderEmpty } from "./OpenFolderEmpty";
import { SecretsSection } from "./SecretsSection";

// THE sidebar: one per window (rendered by App, beside the ActivityBar), not
// one per pane. It shows a single view -- the activity bar's active section --
// and is always bound to the FOCUSED pane's project: with no ProjectPaneContext
// provider above it, useProjectTab() falls back to activeTabId, the same
// "focused pane drives everything" rule the agent, menus, and title follow.
export function Sidebar() {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const vis = useApp((s) => s.sectionVisibility);
  const activeView = useApp((s) => s.activeView);
  const sectionMeta = useApp((s) => s.sectionMeta);
  const requestNewFile = useApp((s) => s.requestNewFile);
  const split = useApp((s) => s.split);
  const activeTabId = useApp((s) => s.activeTabId);

  const view = effectiveView(activeView, vis, sectionMeta);
  const meta = sectionMeta.find((m) => m.id === view) ?? null;
  // Badge the project only while the split is on screen (two projects visible
  // -> say which one the sidebar reflects). A single pane needs no reminder.
  const splitShowing =
    split !== null && (activeTabId === split.a || activeTabId === split.b);

  let body: ReactNode = null;
  if (view === "files") {
    body = root ? (
      <FileTree />
    ) : (
      <OpenFolderEmpty message="No folder is open in this tab." />
    );
  } else if (view === "secrets") body = <SecretsSection />;
  else if (view === "git") body = <GitSection />;
  else if (view === "activity") body = <ActivitySection />;
  else if (view === "databases") body = <DatabasesSection />;
  else if (view === "host") body = <LocalHostSection />;
  else if (view === "audit") body = <AuditSection />;
  else if (view === "events") body = <EventsSection />;
  else {
    // An ext:<id> view: its registered component, else the generic resource
    // list -- so an extension with no bespoke UI still gets a usable section.
    const extId = view ? parseExtSection(view) : null;
    if (extId) {
      const View = sidebarViewFor(extId);
      body = View ? <View /> : <ExtensionResourcesSection extId={extId} />;
    }
  }

  return (
    <aside className="sidebar">
      {meta ? (
        <>
          <div className="sidebar-view-header">
            <span className="sidebar-view-title">{meta.label}</span>
            {splitShowing && root && (
              <span className="sidebar-view-project" title={root}>
                {root.split("/").pop()}
              </span>
            )}
            {view === "files" && root && (
              <span className="section-actions">
                <button
                  type="button"
                  className="row-action"
                  title="New File"
                  onClick={() => requestNewFile(tabId, "file")}
                >
                  <i className="codicon codicon-new-file" />
                </button>
                <button
                  type="button"
                  className="row-action"
                  title="New Folder"
                  onClick={() => requestNewFile(tabId, "dir")}
                >
                  <i className="codicon codicon-new-folder" />
                </button>
              </span>
            )}
            {view === "host" && (
              <span className="section-actions persistent">
                <button
                  type="button"
                  className="row-action"
                  title="Refresh dev server, Render & Azure"
                  onClick={() => useApp.getState().bumpHostRefresh()}
                >
                  <i className="codicon codicon-refresh" />
                </button>
              </span>
            )}
          </div>
          <div className="sidebar-view-body">{body}</div>
        </>
      ) : (
        <div className="sidebar-empty">
          All sections hidden. Re-enable them from View → Sidebar.
        </div>
      )}
    </aside>
  );
}
