import { type ReactNode, useEffect, useState } from "react";
import type { Section as SectionId } from "../../../shared/ipc";
import { openPickedFolder } from "../lib/openFolder";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";
import { ActivitySection } from "./ActivitySection";
import { AuditSection } from "./AuditSection";
import { DatabasesSection } from "./DatabasesSection";
import { DockerSection } from "./DockerSection";
import { FileTree } from "./FileTree";
import { GitSection } from "./GitSection";
import { LocalHostSection } from "./LocalHostSection";
import { NeonSection } from "./NeonSection";
import { RenderSection } from "./RenderSection";
import { SecretsSection } from "./SecretsSection";
import { SidebarFooter } from "./SidebarFooter";

function Section({
  id,
  title,
  children,
  defaultOpen = true,
}: {
  id: SectionId;
  title: string;
  children?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);
  return (
    <div className="section">
      <button
        type="button"
        className="section-header"
        onClick={() => setOpen(!open)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <i className={`codicon codicon-chevron-${open ? "down" : "right"}`} />
        <span className="section-title">{title}</span>
      </button>
      {open && <div className="section-body">{children}</div>}
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
                void window.airlock.setSectionVisibility(id, false);
                setMenu(null);
              }}
            >
              <span>Hide {title}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Sidebar() {
  // Scope the empty-state check to the pane's tab (each pane's sidebar shows its
  // own project's Files). The openFolder handler stays as-is for now -- per-pane
  // opening is a later task and single pane is unaffected.
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const vis = useApp((s) => s.sectionVisibility);

  const openFolder = async () => {
    try {
      const picked = await window.airlock.openFolder();
      if (picked) await openPickedFolder(picked);
    } catch (err) {
      console.error("openFolder failed", err);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-sections">
        {vis.files && (
          <Section id="files" title="Files">
            {root ? (
              <FileTree />
            ) : (
              <button
                type="button"
                className="open-folder"
                onClick={openFolder}
              >
                Open Folder…
              </button>
            )}
          </Section>
        )}
        {vis.secrets && (
          <Section id="secrets" title="Secrets">
            <SecretsSection />
          </Section>
        )}
        {vis.git && (
          <Section id="git" title="Git">
            <GitSection />
          </Section>
        )}
        {vis.activity && (
          <Section id="activity" title="Activity" defaultOpen={false}>
            <ActivitySection />
          </Section>
        )}
        {vis.databases && (
          <Section id="databases" title="Databases" defaultOpen={false}>
            <NeonSection />
            <DatabasesSection />
          </Section>
        )}
        {vis.docker && (
          <Section id="docker" title="Docker" defaultOpen={false}>
            <DockerSection />
          </Section>
        )}
        {vis.host && (
          <Section id="host" title="Host" defaultOpen={false}>
            <LocalHostSection />
            <RenderSection />
          </Section>
        )}
        {vis.audit && (
          <Section id="audit" title="Audit" defaultOpen={false}>
            <AuditSection />
          </Section>
        )}
        {!Object.values(vis).some(Boolean) && (
          <div className="sidebar-empty">
            All sections hidden. Re-enable them from View → Sidebar.
          </div>
        )}
      </div>
      <SidebarFooter />
    </aside>
  );
}
