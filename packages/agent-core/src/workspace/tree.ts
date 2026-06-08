import { readdir, realpath } from "node:fs/promises";
import path from "node:path";

export interface DirEntry {
  name: string;
  type: "file" | "dir";
}

// The committed per-folder ordering file (see workspace/fileOrder.ts). Hidden
// from the tree like .DS_Store, but -- unlike .airlock -- NOT gitignored, so a
// project's custom order travels with it.
export const ORDER_FILE = ".airlock-order.json";

const IGNORED = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  ".airlock",
  ".DS_Store",
  ORDER_FILE,
]);

// NOTE: Do not use multibyte chars (e.g. the section sign, copyright sign) in
// comments in agent-core sources: they are bundled into the Electron CJS main
// via electron-vite, and Electron's cjs_lexer asserts on multibyte chars there.
// Context: commit 4a3beb2 (a section-sign character crashed the main process).

/**
 * Resolve relPath against root and guarantee the real (symlink-resolved)
 * location stays inside root. Spec S6: all file tools are workspace-rooted;
 * symlinks resolve before the check.
 */
export async function resolveWithin(
  root: string,
  relPath: string,
): Promise<string> {
  const realRoot = await realpath(path.resolve(root));
  const abs = path.resolve(realRoot, relPath);
  let real: string;
  try {
    real = await realpath(abs);
  } catch {
    // Path does not exist yet (future write_file).
    // Walk up to the nearest existing ancestor, realpath that, then re-join
    // the non-existing suffix. This resolves any symlinks in the ancestor chain
    // before the containment check, preventing escape through a symlinked dir.
    let ancestor = abs;
    let suffix = "";
    while (true) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) {
        real = abs; // reached fs root without finding an existing ancestor; fall back
        break;
      }
      suffix = suffix
        ? path.join(path.basename(ancestor), suffix)
        : path.basename(ancestor);
      ancestor = parent;
      try {
        const resolvedAncestor = await realpath(ancestor);
        real = suffix ? path.join(resolvedAncestor, suffix) : resolvedAncestor;
        break;
      } catch {
        // this ancestor also doesn't exist; keep walking up
      }
    }
  }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new Error(`Path escapes workspace: ${relPath}`);
  }
  return real;
}

// True if relPath targets the .airlock vault dir at ANY depth, AFTER collapsing
// "."/".." -- so "./.airlock/x", "sub/../.airlock/x", and "a/.airlock/b" are all
// caught (a raw first-segment check would miss them). The vault holds secret
// METADATA + the audit chain; UI file ops must never mutate it. Defense in depth:
// listDirectory already hides .airlock (IGNORED), so the tree never emits it.
export function targetsVault(relPath: string): boolean {
  return path
    .normalize(relPath)
    .split(/[/\\]/)
    .some((seg) => seg === ".airlock");
}

export async function listDirectory(
  root: string,
  relPath = ".",
): Promise<DirEntry[]> {
  const abs = await resolveWithin(root, relPath);
  const dirents = await readdir(abs, { withFileTypes: true });
  return dirents
    .filter((d) => !IGNORED.has(d.name))
    .map<DirEntry>((d) => ({
      name: d.name,
      // Dirent uses lstat semantics: a symlink is never isDirectory()===true on POSIX.
      // (Windows junctions behave differently - revisit if Windows lands; spec is macOS-only.)
      type: d.isDirectory() ? "dir" : "file",
    }))
    .sort((a, b) =>
      a.type === b.type
        ? a.name.localeCompare(b.name)
        : a.type === "dir"
          ? -1
          : 1,
    );
}
