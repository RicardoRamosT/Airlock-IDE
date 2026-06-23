import { useApp } from "../store";

// Load a file's content and open it as an editor tab in the given project tab.
// Shared by the file tree, the unified tab bar, and the File menu so they all
// open files the same way (read the pane's project, then store.openFile).
// Pass `line` to also emit a one-shot revealLine signal after opening.
export async function openEditorFile(
  tabId: string,
  relPath: string,
  line?: number,
): Promise<void> {
  const root = useApp.getState().tabState[tabId]?.root;
  if (!root) return;
  try {
    const file = await window.airlock.readFile(root, relPath);
    useApp.getState().openFile(relPath, file, tabId);
    if (line !== undefined) useApp.getState().revealLine(tabId, relPath, line);
  } catch (err) {
    console.error("open file failed", err);
  }
}

// Pure: the id of the first open tab whose root matches, else null.
export function resolveRootTabId(
  tabs: { id: string; root: string | null }[],
  root: string,
): string | null {
  return tabs.find((t) => t.root === root)?.id ?? null;
}

// Open relPath in the project whose root is `root` (NOT the focused tab). The
// Overview is shown for a specific project that may not be the active tab, so an
// in-overview link must resolve against its OWN root. If that project's tab was
// closed, reopen it first.
export async function openFileInRoot(
  root: string,
  relPath: string,
  line?: number,
): Promise<void> {
  let tabId = resolveRootTabId(useApp.getState().tabs, root);
  if (!tabId) {
    useApp.getState().openProject(root);
    tabId = useApp.getState().activeTabId;
  }
  await openEditorFile(tabId, relPath, line);
}

// Close an editor tab. If it was the ACTIVE file, activate a neighbor file first
// (next, else previous) so the editor stays on a file rather than dropping to
// the terminal when other files are still open.
export async function closeEditorFile(
  tabId: string,
  relPath: string,
): Promise<void> {
  const cur = useApp.getState().tabState[tabId];
  if (!cur) return;
  if (cur.selectedFile === relPath) {
    const idx = cur.editorTabs.indexOf(relPath);
    const neighbor = cur.editorTabs[idx + 1] ?? cur.editorTabs[idx - 1] ?? null;
    if (neighbor) await openEditorFile(tabId, neighbor);
  }
  useApp.getState().closeEditorTab(relPath, tabId);
}
