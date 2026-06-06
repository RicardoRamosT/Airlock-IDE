import { useEffect, useState } from "react";
import type { DirEntry } from "../../../shared/ipc";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";

function join(parent: string, name: string): string {
  return parent === "." ? name : `${parent}/${name}`;
}

function Node({ entry, parent }: { entry: DirEntry; parent: string }) {
  const relPath = join(parent, entry.name);
  if (entry.type === "dir")
    return <DirNode name={entry.name} relPath={relPath} />;
  return <FileNode name={entry.name} relPath={relPath} />;
}

function FileNode({ name, relPath }: { name: string; relPath: string }) {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const selectedFile = useApp((s) => s.tabState[tabId]?.selectedFile ?? null);
  const setSelected = useApp((s) => s.setSelected);
  const select = async () => {
    if (!root) return;
    try {
      // Pass the PANE's root so the read resolves THIS pane's project (two panes
      // share one window). The state write is scoped to the same pane via tabId.
      const file = await window.airlock.readFile(root, relPath);
      setSelected(relPath, file, tabId);
    } catch (err) {
      console.error("readFile failed", err);
    }
  };
  return (
    <button
      type="button"
      className={`tree-item${selectedFile === relPath ? " selected" : ""}`}
      onClick={select}
    >
      <i className="codicon codicon-file" />
      {name}
    </button>
  );
}

function DirNode({ name, relPath }: { name: string; relPath: string }) {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    // TODO: invalidate on workspace:changed once file-watching lands
    if (next && children === null && root) {
      try {
        setChildren(await window.airlock.listDir(root, relPath));
      } catch (err) {
        console.error("listDir failed", err);
        setOpen(false); // collapse back; otherwise arrow shows open with no children
      }
    }
  };
  return (
    <div>
      <button type="button" className="tree-item dir" onClick={toggle}>
        <i className={`codicon codicon-chevron-${open ? "down" : "right"}`} />
        {name}
      </button>
      {open && children && (
        <div className="tree-children">
          {children.map((c) => (
            <Node key={c.name} entry={c} parent={relPath} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree() {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);

  useEffect(() => {
    if (!root) {
      setEntries(null);
      return;
    }
    window.airlock.listDir(root, ".").then(setEntries).catch(console.error);
  }, [root]);

  if (!root) return null;
  if (!entries) return <div className="tree-empty">loading…</div>;
  return (
    <div className="tree">
      {entries.map((e) => (
        <Node key={e.name} entry={e} parent="." />
      ))}
    </div>
  );
}
