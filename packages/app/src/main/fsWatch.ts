import { type FSWatcher, watch } from "chokidar";
import { BrowserWindow, type WebContents } from "electron";

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

// Dependency, build, and cache dirs the recursive watcher must NEVER descend
// into. Critical because chokidar v5 has no fsevents backend, so it opens ONE
// fd PER WATCHED FILE; macOS caps a process at kern.maxfilesperproc (10240 on
// this machine). A single big tree blows past that -> EMFILE -> the cascade
// that breaks pty spawn, the MCP socket, and DevTools. Real offenders seen: a
// project's Python virtualenv (venv, ~12.5k files) and .claude/worktrees (git
// worktrees). The file TREE still lists these (lazily); only the recursive
// WATCHER skips them. ASCII-only file (bundled into the Electron CJS main).
const IGNORED_DIRS = new Set([
  ".git",
  ".claude", // agent infra: worktrees / transcripts / image-cache (huge)
  ".airlock", // the secrets/audit vault
  // JS/web deps, build output, caches
  "node_modules",
  "dist",
  "out",
  "build",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "coverage",
  // Python virtualenvs + caches (pdfextractor's venv was the EMFILE trigger)
  "venv",
  ".venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  // other ecosystems
  "target", // Rust
  "vendor", // Go / PHP vendored deps
  ".gradle", // Java
  ".DS_Store",
]);

// Exported for unit tests. True if any path segment is an ignored dep/build/
// cache dir, or the committed .airlock-order.json (+ its atomic-write temp, so
// writing it never fires a debounced fs:changed re-list).
export function isIgnored(p: string): boolean {
  for (const seg of p.split(/[/\\]/)) {
    if (IGNORED_DIRS.has(seg)) return true;
    if (seg === ".airlock-order.json" || seg === ".airlock-order.json.tmp")
      return true;
  }
  return false;
}

// Reconcile the set of watchers for one window to exactly `roots`.
export function syncWindowWatchers(wc: WebContents, roots: string[]): void {
  // Key by BrowserWindow id, NOT WebContents id: disposeWindowWatchers is called
  // with the BrowserWindow id on window-close, so keying this map by wc.id would
  // never match the dispose and every closed window would leak its watchers.
  // (audit PB-C4)
  const id = BrowserWindow.fromWebContents(wc)?.id;
  if (id === undefined) return;
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
      .on("unlinkDir", fire)
      // Never let a watcher error (EMFILE on a huge tree, EPERM, a dir that
      // vanished mid-scan) escape as an uncaught exception and destabilize the
      // main process. Log it and keep going.
      .on("error", (err) => {
        console.error(`[fsWatch] watcher error for ${root}:`, err);
      });
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
