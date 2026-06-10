import type { ReactNode } from "react";
import { openPickedFolder } from "../lib/openFolder";
import { useProjectTab } from "../lib/projectPane";
import { effectiveView, SECTION_META } from "../lib/sections";
import { useApp } from "../store";
import { ActivitySection } from "./ActivitySection";
import { AuditSection } from "./AuditSection";
import { DatabasesSection } from "./DatabasesSection";
import { DockerSection } from "./DockerSection";
import { FileTree } from "./FileTree";
import { GitSection } from "./GitSection";
import { LocalHostSection } from "./LocalHostSection";
import { NeonSection } from "./NeonSection";
import { QuotaMeter } from "./QuotaMeter";
import { RenderSection } from "./RenderSection";
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
  const requestNewFile = useApp((s) => s.requestNewFile);
  const split = useApp((s) => s.split);
  const activeTabId = useApp((s) => s.activeTabId);

  const view = effectiveView(activeView, vis);
  const meta = SECTION_META.find((m) => m.id === view) ?? null;
  // Badge the project only while the split is on screen (two projects visible
  // -> say which one the sidebar reflects). A single pane needs no reminder.
  const splitShowing =
    split !== null && (activeTabId === split.a || activeTabId === split.b);

  const openFolder = async () => {
    try {
      const picked = await window.airlock.openFolder();
      if (picked) await openPickedFolder(picked);
    } catch (err) {
      console.error("openFolder failed", err);
    }
  };

  let body: ReactNode = null;
  if (view === "files") {
    body = root ? (
      <FileTree />
    ) : (
      <div className="open-folder-empty">
        <p className="section-note">No folder is open in this tab.</p>
        <button type="button" className="open-folder" onClick={openFolder}>
          <i className="codicon codicon-folder-opened" />
          Open Folder…
        </button>
      </div>
    );
  } else if (view === "secrets") body = <SecretsSection />;
  else if (view === "git") body = <GitSection />;
  else if (view === "activity") body = <ActivitySection />;
  else if (view === "databases")
    body = (
      <>
        <NeonSection />
        <DatabasesSection />
      </>
    );
  else if (view === "docker") body = <DockerSection />;
  else if (view === "host")
    body = (
      <>
        <LocalHostSection />
        <RenderSection />
      </>
    );
  else if (view === "audit") body = <AuditSection />;

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
                  className="section-action"
                  title="New File"
                  onClick={() => requestNewFile(tabId, "file")}
                >
                  <i className="codicon codicon-new-file" />
                </button>
                <button
                  type="button"
                  className="section-action"
                  title="New Folder"
                  onClick={() => requestNewFile(tabId, "dir")}
                >
                  <i className="codicon codicon-new-folder" />
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
      <QuotaMeter />
    </aside>
  );
}
