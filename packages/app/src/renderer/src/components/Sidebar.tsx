import { type ReactNode, useState } from "react";
import { useApp } from "../store";
import { AuditSection } from "./AuditSection";
import { DatabasesSection } from "./DatabasesSection";
import { FileTree } from "./FileTree";
import { GitSection } from "./GitSection";
import { SecretsSection } from "./SecretsSection";
import { SidebarFooter } from "./SidebarFooter";

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <button
        type="button"
        className="section-header"
        onClick={() => setOpen(!open)}
      >
        <i className={`codicon codicon-chevron-${open ? "down" : "right"}`} />
        <span className="section-title">{title}</span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

export function Sidebar() {
  const { root, setRoot } = useApp();

  const openFolder = async () => {
    try {
      const picked = await window.airlock.openFolder();
      if (picked) setRoot(picked);
    } catch (err) {
      console.error("openFolder failed", err);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-sections">
        <Section title="Files">
          {root ? (
            <FileTree />
          ) : (
            <button type="button" className="open-folder" onClick={openFolder}>
              Open Folder…
            </button>
          )}
        </Section>
        <Section title="Secrets">
          <SecretsSection />
        </Section>
        <Section title="Git">
          <GitSection />
        </Section>
        <Section title="Databases" defaultOpen={false}>
          <DatabasesSection />
        </Section>
        <Section title="Audit" defaultOpen={false}>
          <AuditSection />
        </Section>
      </div>
      <SidebarFooter />
    </aside>
  );
}
