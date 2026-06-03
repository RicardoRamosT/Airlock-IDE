import { useEffect, useState } from "react";
import type { DirEntry } from "../../../shared/ipc";
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
  const { selectedFile, setSelected } = useApp();
  const select = async () => {
    try {
      const file = await window.airlock.readFile(relPath);
      setSelected(relPath, file);
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
      {name}
    </button>
  );
}

function DirNode({ name, relPath }: { name: string; relPath: string }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    // TODO: invalidate on workspace:changed once file-watching lands
    if (next && children === null) {
      try {
        setChildren(await window.airlock.listDir(relPath));
      } catch (err) {
        console.error("listDir failed", err);
        setOpen(false); // collapse back; otherwise arrow shows open with no children
      }
    }
  };
  return (
    <div>
      <button type="button" className="tree-item dir" onClick={toggle}>
        {open ? "▾" : "▸"} {name}
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
  const root = useApp((s) => s.root);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);

  useEffect(() => {
    if (!root) {
      setEntries(null);
      return;
    }
    window.airlock.listDir(".").then(setEntries).catch(console.error);
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
