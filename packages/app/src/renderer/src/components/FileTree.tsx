import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { DirEntry } from "../../../shared/ipc";
import { openEditorFile } from "../lib/editorFiles";
import { applyOrder } from "../lib/fileOrder";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";

function join(parent: string, name: string): string {
  return parent === "." ? name : `${parent}/${name}`;
}

// The containing directory of a relPath ("." for a top-level entry). Used to
// resolve a drop ONTO a file to that file's folder, and the same-parent no-op.
function parentOf(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i >= 0 ? rel.slice(0, i) : ".";
}

// What is currently being inline-edited. `create-*` shows a fresh empty input
// row under `parentRel` (the folder to create in); `rename` swaps a node's
// label for an input prefilled with its current name.
type Editing =
  | { kind: "create-file"; parentRel: string }
  | { kind: "create-dir"; parentRel: string }
  | { kind: "rename"; relPath: string }
  | null;

// Right-click target. A null kind means the tree background (create in root).
type Menu =
  | { x: number; y: number; kind: "file"; relPath: string }
  | { x: number; y: number; kind: "dir"; relPath: string }
  | { x: number; y: number; kind: "bg" }
  | null;

// The controller wires the recursive tree nodes back to FileTree's single
// editing/menu state without prop-drilling through every Node. The split layout
// already gives each pane its own FileTree, so one controller per tree is fine.
interface TreeCtl {
  editing: Editing;
  setEditing: (e: Editing) => void;
  openMenu: (m: Menu) => void;
  doCreateFile: (parentRel: string, name: string) => Promise<void>;
  doCreateDir: (parentRel: string, name: string) => Promise<void>;
  doRename: (relPath: string, newName: string) => Promise<void>;
  // Drag-and-drop move
  dragged: string | null;
  setDragged: (relPath: string | null) => void;
  canDropInto: (targetDirRel: string) => boolean;
  doMove: (toDirRel: string) => Promise<void>;
}
const TreeCtlContext = createContext<TreeCtl | null>(null);
const useTreeCtl = (): TreeCtl => {
  const ctl = useContext(TreeCtlContext);
  if (!ctl) throw new Error("TreeCtl missing");
  return ctl;
};

// Inline name input shared by create (empty) and rename (prefilled). Enter
// commits via onCommit; Escape/blur cancels (onCancel). On a rejected commit
// (e.g. name conflict) it KEEPS the input open and shows the message inline.
function NameInput({
  initial,
  selectBase,
  onCommit,
  onCancel,
}: {
  initial: string;
  selectBase?: boolean;
  onCommit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Rename: select just the basename (not the extension) when it is easy.
    const dot = selectBase ? initial.lastIndexOf(".") : -1;
    if (dot > 0) el.setSelectionRange(0, dot);
    else el.select();
  }, [initial, selectBase]);

  const commit = async () => {
    const name = value.trim();
    if (!name) {
      onCancel();
      return;
    }
    try {
      await onCommit(name);
      onCancel(); // success -> clear the editing state
    } catch (err) {
      // Keep the input open; surface the IPC rejection message inline.
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="tree-item">
      <form
        style={{ flex: 1 }}
        onSubmit={(e) => {
          e.preventDefault();
          void commit();
        }}
      >
        <input
          ref={ref}
          className="tree-rename-input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onBlur={onCancel}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
          }}
          spellCheck={false}
        />
        {error && <div className="tree-error">{error}</div>}
      </form>
    </div>
  );
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
  const {
    editing,
    setEditing,
    openMenu,
    doRename,
    setDragged,
    canDropInto,
    doMove,
  } = useTreeCtl();
  const [over, setOver] = useState(false);
  // Dropping ONTO a file targets that file's folder (VS Code-like), so a drop
  // near a file does the intuitive thing instead of falling through to the root.
  const dropDir = parentOf(relPath);

  if (editing?.kind === "rename" && editing.relPath === relPath) {
    return (
      <NameInput
        initial={name}
        selectBase
        onCommit={(n) => doRename(relPath, n)}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <button
      type="button"
      className={`tree-item${selectedFile === relPath ? " selected" : ""}${over ? " drop-target" : ""}`}
      draggable
      // Open as an editor tab in THIS pane (openEditorFile reads the pane's
      // project root, then store.openFile -- scoped via tabId).
      onClick={() => void openEditorFile(tabId, relPath)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation(); // do not also fire the tree-background (root) menu
        openMenu({ x: e.clientX, y: e.clientY, kind: "file", relPath });
      }}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", relPath);
        setDragged(relPath);
      }}
      onDragEnd={() => {
        setDragged(null);
        setOver(false);
      }}
      onDragOver={(e) => {
        if (!canDropInto(dropDir)) return;
        e.preventDefault();
        e.stopPropagation(); // innermost target wins; don't bubble to the root
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        void doMove(dropDir);
      }}
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
  const folderOrder = useApp((s) =>
    root ? s.fileOrder[root]?.[relPath] : undefined,
  );
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [over, setOver] = useState(false);
  const {
    editing,
    setEditing,
    openMenu,
    doCreateFile,
    doCreateDir,
    doRename,
    setDragged,
    canDropInto,
    doMove,
  } = useTreeCtl();

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

  // A pending "new file/folder" under THIS dir (shown as an extra input row).
  const creating =
    (editing?.kind === "create-file" || editing?.kind === "create-dir") &&
    editing.parentRel === relPath
      ? editing.kind
      : null;

  if (editing?.kind === "rename" && editing.relPath === relPath) {
    return (
      <NameInput
        initial={name}
        selectBase
        onCommit={(n) => doRename(relPath, n)}
        onCancel={() => setEditing(null)}
      />
    );
  }

  const dirOrdered = applyOrder(children ?? [], folderOrder); // custom order for this dir

  return (
    <div>
      <button
        type="button"
        className={`tree-item dir${over ? " drop-target" : ""}`}
        draggable
        // Creating inside a collapsed dir: expand so the input row is visible.
        onClick={() => setOpen((o) => !o)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation(); // do not also fire the tree-background (root) menu
          openMenu({ x: e.clientX, y: e.clientY, kind: "dir", relPath });
        }}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", relPath);
          setDragged(relPath);
        }}
        onDragEnd={() => {
          setDragged(null);
          setOver(false);
        }}
        onDragOver={(e) => {
          if (!canDropInto(relPath)) return;
          e.preventDefault();
          e.stopPropagation(); // innermost folder wins; don't bubble to the root
          e.dataTransfer.dropEffect = "move";
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          void doMove(relPath);
        }}
      >
        <i className={`codicon codicon-chevron-${open ? "down" : "right"}`} />
        {name}
      </button>
      {(open || creating) && (
        <div className="tree-children">
          {creating === "create-file" && (
            <NameInput
              initial=""
              onCommit={(n) => doCreateFile(relPath, n)}
              onCancel={() => setEditing(null)}
            />
          )}
          {creating === "create-dir" && (
            <NameInput
              initial=""
              onCommit={(n) => doCreateDir(relPath, n)}
              onCancel={() => setEditing(null)}
            />
          )}
          {dirOrdered.map((c) => (
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
  const rootOrder = useApp((s) => (root ? s.fileOrder[root] : undefined));
  const loadFileOrder = useApp((s) => s.loadFileOrder);
  useEffect(() => {
    if (root) void loadFileOrder(root);
  }, [root, loadFileOrder]);
  const renameFilePath = useApp((s) => s.renameFilePath);
  const newFileRequest = useApp((s) => s.newFileRequest);
  const clearNewFileRequest = useApp((s) => s.clearNewFileRequest);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [rootOver, setRootOver] = useState(false);

  // The FILES header's New File/Folder buttons signal a create-at-root here.
  useEffect(() => {
    if (newFileRequest?.tabId !== tabId) return;
    setEditing(
      newFileRequest.kind === "file"
        ? { kind: "create-file", parentRel: "." }
        : { kind: "create-dir", parentRel: "." },
    );
    clearNewFileRequest();
  }, [newFileRequest, tabId, clearNewFileRequest]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fsVersion is an invalidation trigger, not used in the body
  useEffect(() => {
    if (!root) {
      setEntries(null);
      return;
    }
    window.airlock.listDir(root, ".").then(setEntries).catch(console.error);
  }, [root, fsVersion]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  // --- The 5 fs ops. The watcher (Task 4) re-lists the tree after any change,
  // so these never reload manually; they just clear the editing state. On an
  // IPC rejection the error bubbles to NameInput, which keeps its input open. ---
  const doCreateFile = async (parentRel: string, name: string) => {
    if (!root) return;
    await window.airlock.createFile(root, join(parentRel, name));
  };
  const doCreateDir = async (parentRel: string, name: string) => {
    if (!root) return;
    await window.airlock.createDir(root, join(parentRel, name));
  };
  const doRename = async (relPath: string, newName: string) => {
    if (!root) return;
    const slash = relPath.lastIndexOf("/");
    const parent = slash >= 0 ? relPath.slice(0, slash) : ".";
    const toRel = join(parent, newName);
    await window.airlock.moveFile(root, relPath, toRel);
    renameFilePath(relPath, toRel, tabId); // keep open editors at the new path
  };
  const doDuplicate = async (relPath: string) => {
    if (!root) return;
    await window.airlock.duplicateFile(root, relPath);
  };
  const doTrash = async (relPath: string, isDir: boolean) => {
    if (!root) return;
    // A folder may contain things we cannot see from a collapsed row, so always
    // confirm a folder delete. Files go straight to Trash (recoverable).
    if (isDir && !window.confirm(`Delete "${relPath}"?`)) return;
    await window.airlock.trashFile(root, relPath);
    // Close any open editor at/under the deleted path.
    for (const p of useApp.getState().tabState[tabId]?.editorTabs ?? []) {
      if (p === relPath || p.startsWith(`${relPath}/`))
        useApp.getState().closeEditorTab(p, tabId);
    }
  };

  const canDropInto = (toDirRel: string): boolean => {
    if (!dragged) return false;
    if (parentOf(dragged) === toDirRel) return false; // already there
    // cannot drop a folder into itself or its own descendant
    if (toDirRel === dragged || toDirRel.startsWith(`${dragged}/`))
      return false;
    return true;
  };

  const doMove = async (toDirRel: string) => {
    if (!root || !dragged || !canDropInto(toDirRel)) return;
    const base = dragged.slice(dragged.lastIndexOf("/") + 1);
    const toRel = join(toDirRel, base);
    try {
      await window.airlock.moveFile(root, dragged, toRel);
      renameFilePath(dragged, toRel, tabId); // open editors follow the move
    } catch (err) {
      // e.g. destination already exists -- leave things as they are.
      console.error("move failed", err);
    }
  };

  const ctl: TreeCtl = {
    editing,
    setEditing,
    openMenu: setMenu,
    doCreateFile,
    doCreateDir,
    doRename,
    dragged,
    setDragged,
    canDropInto,
    doMove,
  };

  if (!root) return null;
  if (!entries) return <div className="tree-empty">loading…</div>;

  const rootOrdered = applyOrder(entries, rootOrder?.["."]); // custom order for the root level

  // The folder a "New File/Folder" lands in for the current menu target: a file
  // creates in its PARENT, a dir creates INSIDE itself, the background in root.
  const createParent = (): string => {
    if (!menu || menu.kind === "bg") return ".";
    if (menu.kind === "dir") return menu.relPath;
    const slash = menu.relPath.lastIndexOf("/");
    return slash >= 0 ? menu.relPath.slice(0, slash) : ".";
  };

  return (
    <TreeCtlContext.Provider value={ctl}>
      {/* Right-clicking empty space below the rows targets the root. Rows
          stopPropagation so this fires only on genuine background clicks. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: container right-click affordance (New File/Folder in root), not a focusable control */}
      <div
        className={`tree${rootOver ? " drop-target-root" : ""}`}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, kind: "bg" });
        }}
        // Dropping on empty space (rows stopPropagation) moves to the root.
        onDragOver={(e) => {
          if (!canDropInto(".")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setRootOver(true);
        }}
        // Clear on any leave: moving onto a row clears the root highlight (the
        // row stopPropagations its own dragover), and dragover re-asserts it the
        // moment the pointer is back over empty space.
        onDragLeave={() => setRootOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setRootOver(false);
          void doMove(".");
        }}
      >
        {editing?.kind === "create-file" && editing.parentRel === "." && (
          <NameInput
            initial=""
            onCommit={(n) => doCreateFile(".", n)}
            onCancel={() => setEditing(null)}
          />
        )}
        {editing?.kind === "create-dir" && editing.parentRel === "." && (
          <NameInput
            initial=""
            onCommit={(n) => doCreateDir(".", n)}
            onCancel={() => setEditing(null)}
          />
        )}
        {rootOrdered.map((e) => (
          <Node key={e.name} entry={e} parent="." />
        ))}
      </div>
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
                setEditing({ kind: "create-file", parentRel: createParent() });
                setMenu(null);
              }}
            >
              <span>New File</span>
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setEditing({ kind: "create-dir", parentRel: createParent() });
                setMenu(null);
              }}
            >
              <span>New Folder</span>
            </button>
            {menu.kind !== "bg" && (
              <>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setEditing({ kind: "rename", relPath: menu.relPath });
                    setMenu(null);
                  }}
                >
                  <span>Rename</span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    void doDuplicate(menu.relPath);
                    setMenu(null);
                  }}
                >
                  <span>Duplicate</span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    void doTrash(menu.relPath, menu.kind === "dir");
                    setMenu(null);
                  }}
                >
                  <span>Delete</span>
                </button>
              </>
            )}
          </div>
        </>
      )}
    </TreeCtlContext.Provider>
  );
}
