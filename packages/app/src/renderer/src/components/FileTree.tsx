import { useEffect, useState } from "react";
import type { DirEntry } from "../../../shared/ipc";
import { openEditorFile } from "../lib/editorFiles";
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
  const selectedFile = useApp((s) => s.tabState[tabId]?.selectedFile ?? null);
  return (
    <button
      type="button"
      className={`tree-item${selectedFile === relPath ? " selected" : ""}`}
      // Open as an editor tab in THIS pane (openEditorFile reads the pane's
      // project root, then store.openFile -- scoped via tabId).
      onClick={() => void openEditorFile(tabId, relPath)}
    >
      <i className="codicon codicon-file" />
      {name}
    </button>
  );
}

function DirNode({ name, relPath }: { name: string; relPath: string }) {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const fsVersion = useApp((s) => (root ? (s.fsVersion[root] ?? 0) : 0));
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);

  // Reload children whenever this dir is open and the tree changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fsVersion is an invalidation trigger, not used in the body
  useEffect(() => {
    if (!open || !root) return;
    let cancelled = false;
    window.airlock
      .listDir(root, relPath)
      .then((c) => {
        if (!cancelled) setChildren(c);
      })
      .catch((err) => console.error("listDir failed", err));
    return () => {
      cancelled = true;
    };
  }, [open, root, relPath, fsVersion]);

  return (
    <div>
      <button
        type="button"
        className="tree-item dir"
        onClick={() => setOpen((o) => !o)}
      >
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
  const fsVersion = useApp((s) => (root ? (s.fsVersion[root] ?? 0) : 0));
  const [entries, setEntries] = useState<DirEntry[] | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fsVersion is an invalidation trigger, not used in the body
  useEffect(() => {
    if (!root) {
      setEntries(null);
      return;
    }
    window.airlock.listDir(root, ".").then(setEntries).catch(console.error);
  }, [root, fsVersion]);

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
