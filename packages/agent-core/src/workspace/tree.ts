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
    // Path may not exist yet (future write_file); containment-check the lexical path.
    real = abs;
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
