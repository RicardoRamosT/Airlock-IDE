import {
  createContext,
  type DragEvent,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { DirEntry } from "../../../shared/ipc";
import { openEditorFile } from "../lib/editorFiles";
import { applyOrder, dropZone, reorderNames } from "../lib/fileOrder";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";
import { FileIcon } from "./FileIcon";

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
  // Reorder `draggedRel` to before/after `targetName` within `folderRel`, using
  // the folder's currently displayed `siblings` names. Persists via the store.
  reorder: (
    folderRel: string,
    draggedRel: string,
    targetName: string,
    place: "before" | "after",
    siblings: string[],
  ) => Promise<void>;
}
const TreeCtlContext = createContext<TreeCtl | null>(null);
const useTreeCtl = (): TreeCtl => {
  const ctl = useContext(TreeCtlContext);
  if (!ctl) throw new Error("TreeCtl missing");
  return ctl;
};

// One drag-and-drop brain per tree row. The pointer band decides intent:
// dropping on a SIBLING row's top/bottom edge reorders within the folder; a
// folder's middle (or any cross-folder drag) MOVES, exactly as before. `parent`
// is the row's container relpath; `siblings` is that container's currently
// displayed entry names (post-applyOrder).
type RowIndicator = "into" | "before" | "after" | null;
function useRowDnd(
  relPath: string,
  parent: string,
  siblings: string[],
  isDir: boolean,
) {
  const { dragged, setDragged, canDropInto, doMove, reorder } = useTreeCtl();
  const [indicator, setIndicator] = useState<RowIndicator>(null);
  const name = relPath.slice(relPath.lastIndexOf("/") + 1);
  const draggedName = dragged
    ? dragged.slice(dragged.lastIndexOf("/") + 1)
    : "";

  const onDragStart = (e: DragEvent<HTMLButtonElement>) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", relPath);
    setDragged(relPath);
  };
  const onDragEnd = () => {
    setDragged(null);
    setIndicator(null);
  };
  const onDragOver = (e: DragEvent<HTMLButtonElement>) => {
    if (!dragged) return;
    const sibling = parentOf(dragged) === parent;
    const z = dropZone(
      e.currentTarget.getBoundingClientRect(),
      e.clientY,
      isDir,
    );
    if (sibling && (z === "before" || z === "after")) {
      if (name === draggedName) return; // never reorder a row against itself
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      setIndicator(z);
      return;
    }
    // Move intent (existing behavior): a dir takes the drop INTO itself; a file
    // resolves to its own folder. Cross-folder drags always land here.
    const target = isDir ? relPath : parent;
    if (!canDropInto(target)) {
      setIndicator(null);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setIndicator("into");
  };
  const onDragLeave = () => setIndicator(null);
  const onDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const ind = indicator;
    setIndicator(null);
    if (!dragged) return;
    if (ind === "before" || ind === "after") {
      void reorder(parent, dragged, name, ind, siblings);
    } else {
      void doMove(isDir ? relPath : parent);
    }
  };
  // Map the indicator to a className suffix: "into" reuses the move-into
  // highlight; before/after draw an insertion line above/below the row.
  const cls =
    indicator === "into"
      ? " drop-target"
      : indicator === "before"
        ? " insert-before"
        : indicator === "after"
          ? " insert-after"
          : "";
  return { cls, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop };
}

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

function Node({
  entry,
  parent,
  siblings,
}: {
  entry: DirEntry;
  parent: string;
  siblings: string[];
}) {
  const relPath = join(parent, entry.name);
  if (entry.type === "dir")
    return (
      <DirNode
        name={entry.name}
        relPath={relPath}
        parent={parent}
        siblings={siblings}
      />
    );
  return (
    <FileNode
      name={entry.name}
      relPath={relPath}
      parent={parent}
      siblings={siblings}
    />
  );
}

function FileNode({
  name,
  relPath,
  parent,
  siblings,
}: {
  name: string;
  relPath: string;
  parent: string;
  siblings: string[];
}) {
  const tabId = useProjectTab();
  const selectedFile = useApp((s) => s.tabState[tabId]?.selectedFile ?? null);
  const { editing, setEditing, openMenu, doRename } = useTreeCtl();
  const dnd = useRowDnd(relPath, parent, siblings, false);

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
      className={`tree-item${selectedFile === relPath ? " selected" : ""}${dnd.cls}`}
      draggable
      // Open as an editor tab in THIS pane (openEditorFile reads the pane's
      // project root, then store.openFile -- scoped via tabId).
      onClick={() => void openEditorFile(tabId, relPath)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation(); // do not also fire the tree-background (root) menu
        openMenu({ x: e.clientX, y: e.clientY, kind: "file", relPath });
      }}
      onDragStart={dnd.onDragStart}
      onDragEnd={dnd.onDragEnd}
      onDragOver={dnd.onDragOver}
      onDragLeave={dnd.onDragLeave}
      onDrop={dnd.onDrop}
    >
      <FileIcon name={name} />
      <span className="tree-label">{name}</span>
    </button>
  );
}

function DirNode({
  name,
  relPath,
  parent,
  siblings,
}: {
  name: string;
  relPath: string;
  parent: string;
  siblings: string[];
}) {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const fsVersion = useApp((s) => (root ? (s.fsVersion[root] ?? 0) : 0));
  const folderOrder = useApp((s) =>
    root ? s.fileOrder[root]?.[relPath] : undefined,
  );
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const { editing, setEditing, openMenu, doCreateFile, doCreateDir, doRename } =
    useTreeCtl();
  const dnd = useRowDnd(relPath, parent, siblings, true);

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
  const dirNames = dirOrdered.map((e) => e.name);

  return (
    <div>
      <button
        type="button"
        className={`tree-item dir${dnd.cls}`}
        draggable
        // Creating inside a collapsed dir: expand so the input row is visible.
        onClick={() => setOpen((o) => !o)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation(); // do not also fire the tree-background (root) menu
          openMenu({ x: e.clientX, y: e.clientY, kind: "dir", relPath });
        }}
        onDragStart={dnd.onDragStart}
        onDragEnd={dnd.onDragEnd}
        onDragOver={dnd.onDragOver}
        onDragLeave={dnd.onDragLeave}
        onDrop={dnd.onDrop}
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
            <Node key={c.name} entry={c} parent={relPath} siblings={dirNames} />
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
  const setFolderOrder = useApp((s) => s.setFolderOrder);
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

  // Reorder within one folder: move draggedRel before/after targetName among
  // the folder's currently displayed `siblings`, then persist. A no-op (same
  // resulting order) is skipped so an idle drop never marks a folder customized.
  const reorder = async (
    folderRel: string,
    draggedRel: string,
    targetName: string,
    place: "before" | "after",
    siblings: string[],
  ) => {
    if (!root) return;
    const draggedName = draggedRel.slice(draggedRel.lastIndexOf("/") + 1);
    const next = reorderNames(siblings, draggedName, targetName, place);
    if (
      next.length === siblings.length &&
      next.every((n, i) => n === siblings[i])
    )
      return;
    await setFolderOrder(root, folderRel, next);
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
    reorder,
  };

  if (!root) return null;
  if (!entries) return <div className="tree-empty">loading…</div>;

  const rootOrdered = applyOrder(entries, rootOrder?.["."]); // custom order for the root level
  const rootNames = rootOrdered.map((e) => e.name);

  // The folder a "New File/Folder" lands in for the current menu target: a file
  // creates in its PARENT, a dir creates INSIDE itself, the background in root.
  const createParent = (): string => {
    if (!menu || menu.kind === "bg") return ".";
    if (menu.kind === "dir") return menu.relPath;
    const slash = menu.relPath.lastIndexOf("/");
    return slash >= 0 ? menu.relPath.slice(0, slash) : ".";
  };

  // The folder a reset applies to for the current menu target, or null for a
  // file row (files do not own an order). "." for the background (root).
  const menuFolder = (): string | null => {
    if (!menu) return null;
    if (menu.kind === "bg") return ".";
    if (menu.kind === "dir") return menu.relPath;
    return null;
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
          <Node key={e.name} entry={e} parent="." siblings={rootNames} />
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
            {(() => {
              const folder = menuFolder();
              if (folder === null || !rootOrder?.[folder]) return null;
              return (
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    void setFolderOrder(root, folder, []);
                    setMenu(null);
                  }}
                >
                  <span>Sort A-Z</span>
                </button>
              );
            })()}
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
