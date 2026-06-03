import type { ReactNode } from "react";
import { useApp } from "../store";
import { FileTree } from "./FileTree";

function Section({
  title,
  children,
  dim,
}: {
  title: string;
  children?: ReactNode;
  dim?: boolean;
}) {
  return (
    <div className={`section${dim ? " dim" : ""}`}>
      <div className="section-title">{title}</div>
      {children}
    </div>
  );
}

export function Sidebar() {
  const { root, setRoot } = useApp();

  const openFolder = async () => {
    const picked = await window.airlock.openFolder();
    if (picked) setRoot(picked);
  };

  return (
    <aside className="sidebar">
      <Section title="Files">
        {root ? (
          <FileTree />
        ) : (
          <button type="button" className="open-folder" onClick={openFolder}>
            Open Folder…
          </button>
        )}
      </Section>
      <Section title="Secrets" dim>
        <div className="section-note">week 3</div>
      </Section>
      <Section title="Git" dim>
        <div className="section-note">week 8</div>
      </Section>
      <Section title="Agent Log" dim>
        <div className="section-note">week 3</div>
      </Section>
    </aside>
  );
}
