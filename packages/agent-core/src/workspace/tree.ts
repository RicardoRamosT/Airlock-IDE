import { readdir, realpath } from "node:fs/promises";
import path from "node:path";

export interface DirEntry {
  name: string;
  type: "file" | "dir";
}

const IGNORED = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  ".airlock",
  ".DS_Store",
]);

/**
 * Resolve relPath against root and guarantee the real (symlink-resolved)
 * location stays inside root. Spec §6: all file tools are workspace-rooted;
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
      // (Windows junctions behave differently — revisit if Windows lands; spec is macOS-only.)
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
