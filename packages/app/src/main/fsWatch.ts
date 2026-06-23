import * as watcher from "@parcel/watcher";
import { BrowserWindow, type WebContents } from "electron";

// One subscription per (window, root). Emits a debounced "fs:changed" {root} to
// the window so its FileTree re-lists. Single source of tree freshness: user
// ops, the agent's terminal mv/rm, and git all surface here. ASCII-only file
// (bundled into the Electron CJS main).
//
// Backend: @parcel/watcher, NOT chokidar. chokidar v5 dropped the fsevents
// backend, so on macOS it opened ONE fd PER WATCHED FILE; a big tree (a Python
// venv, .claude/worktrees) blew past kern.maxfilesperproc (10240) -> EMFILE ->
// a cascade that broke pty spawn, the MCP socket, and DevTools. @parcel/watcher
// uses the OS recursive backend (FSEvents on macOS) = ONE handle per ROOT, so
// fd use is O(open roots), not O(files in the tree). It is the same native
// watcher VS Code uses, and it never re-emits the initial tree (change-only).
type Subscription = Awaited<ReturnType<typeof watcher.subscribe>>;
const watchers = new Map<number, Map<string, Promise<Subscription | null>>>();
const debounces = new Map<string, ReturnType<typeof setTimeout>>();

// Clear any pending debounce for a (window, root) being torn down, so a closed
// root/window cannot fire a stray fs:changed and the map does not grow forever.
function clearDebounce(id: number, root: string): void {
  const key = `${id}:${root}`;
  clearTimeout(debounces.get(key));
  debounces.delete(key);
}

// Dependency, build, and cache dirs the watcher must NEVER surface events for.
// With FSEvents the OS watches the whole tree regardless, so this list is no
// longer about fd survival (it was, under chokidar) -- it is now about NOISE
// and startup cost: the glob form (IGNORE_GLOBS) prunes @parcel/watcher's
// initial recursive crawl, and isIgnored filters events (defense in depth), so
// churn inside node_modules/venv/etc never fires a spurious re-list.
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
  // Python virtualenvs + caches (a project's venv was the EMFILE trigger)
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

// Glob form of IGNORED_DIRS for @parcel/watcher's `ignore` option (prunes its
// initial recursive crawl). Both `**/<dir>` (the dir entry itself) and
// `**/<dir>/**` (its contents) so the whole subtree is skipped. Plus the
// committed order file and its atomic-write temp.
const IGNORE_GLOBS: string[] = [
  ...[...IGNORED_DIRS].map((d) => `**/${d}`),
  ...[...IGNORED_DIRS].map((d) => `**/${d}/**`),
  "**/.airlock-order.json",
  "**/.airlock-order.json.tmp",
];

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

// Reconcile the set of subscriptions for one window to exactly `roots`.
export function syncWindowWatchers(wc: WebContents, roots: string[]): void {
  // Key by BrowserWindow id, NOT WebContents id: disposeWindowWatchers is called
  // with the BrowserWindow id on window-close, so keying this map by wc.id would
  // never match the dispose and every closed window would leak its watchers.
  // (audit PB-C4)
  const id = BrowserWindow.fromWebContents(wc)?.id;
  if (id === undefined) return;
  const current =
    watchers.get(id) ?? new Map<string, Promise<Subscription | null>>();
  // Stop subscriptions for roots no longer open.
  for (const [root, subP] of current) {
    if (!roots.includes(root)) {
      void subP.then((s) => s?.unsubscribe()).catch(() => {});
      clearDebounce(id, root);
      current.delete(root);
    }
  }
  // Start subscriptions for newly opened roots.
  for (const root of roots) {
    if (current.has(root)) continue;
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
    // subscribe is async and can reject (root vanished, EPERM). Store the
    // promise immediately so a same-tick remove can chain its unsubscribe;
    // a failed subscribe resolves to null so dispose is a no-op for it.
    const subP = watcher
      .subscribe(
        root,
        (err, events) => {
          // Never let a watch error (a dir that vanished mid-scan, EPERM)
          // escape as an uncaught exception and destabilize main. Log it.
          if (err) {
            console.error(`[fsWatch] watch error for ${root}:`, err);
            return;
          }
          // Re-list only when a NON-ignored path changed -- defense in depth vs
          // the ignore globs, and it collapses a burst into one debounced send.
          if (events.some((ev) => !isIgnored(ev.path))) fire();
        },
        { ignore: IGNORE_GLOBS },
      )
      .catch((err) => {
        console.error(`[fsWatch] subscribe failed for ${root}:`, err);
        return null;
      });
    current.set(root, subP);
  }
  watchers.set(id, current);
}

// Dispose every subscription for a window (call on window close).
export function disposeWindowWatchers(id: number): void {
  const current = watchers.get(id);
  if (!current) return;
  for (const [root, subP] of current) {
    void subP.then((s) => s?.unsubscribe()).catch(() => {});
    clearDebounce(id, root);
  }
  watchers.delete(id);
}
