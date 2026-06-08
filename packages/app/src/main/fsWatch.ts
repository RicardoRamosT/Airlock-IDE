import { type FSWatcher, watch } from "chokidar";
import type { WebContents } from "electron";

// One watcher per (window, root). Emits a debounced "fs:changed" {root} to the
// window so its FileTree re-lists. Single source of tree freshness: user ops,
// the agent's terminal mv/rm, and git all surface here. ASCII-only file.
const watchers = new Map<number, Map<string, FSWatcher>>();
const debounces = new Map<string, ReturnType<typeof setTimeout>>();

// Clear any pending debounce for a (window, root) being torn down, so a closed
// root/window cannot fire a stray fs:changed and the map does not grow forever.
function clearDebounce(id: number, root: string): void {
  const key = `${id}:${root}`;
  clearTimeout(debounces.get(key));
  debounces.delete(key);
}

// Exported for unit tests. Matches VCS/build dirs, the .airlock vault, and the
// committed .airlock-order.json (so writing the order file never fires a
// debounced fs:changed re-list).
export function isIgnored(p: string): boolean {
  return /(^|[/\\])(\.git|node_modules|\.airlock|\.airlock-order\.json|dist|out|\.DS_Store)([/\\]|$)/.test(
    p,
  );
}

// Reconcile the set of watchers for one window to exactly `roots`.
export function syncWindowWatchers(wc: WebContents, roots: string[]): void {
  const id = wc.id;
  const current = watchers.get(id) ?? new Map<string, FSWatcher>();
  // Stop watchers for roots no longer open.
  for (const [root, w] of current) {
    if (!roots.includes(root)) {
      void w.close();
      clearDebounce(id, root);
      current.delete(root);
    }
  }
  // Start watchers for newly opened roots.
  for (const root of roots) {
    if (current.has(root)) continue;
    const w = watch(root, {
      ignored: isIgnored,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    });
    const fire = () => {
      const key = `${id}:${root}`;
      clearTimeout(debounces.get(key));
      debounces.set(
        key,
        setTimeout(() => {
          if (!wc.isDestroyed()) wc.send("fs:changed", { root });
        }, 150),
      );
    };
    w.on("add", fire)
      .on("addDir", fire)
      .on("unlink", fire)
      .on("unlinkDir", fire);
    current.set(root, w);
  }
  watchers.set(id, current);
}

// Dispose every watcher for a window (call on window close).
export function disposeWindowWatchers(id: number): void {
  const current = watchers.get(id);
  if (!current) return;
  for (const [root, w] of current) {
    void w.close();
    clearDebounce(id, root);
  }
  watchers.delete(id);
}
