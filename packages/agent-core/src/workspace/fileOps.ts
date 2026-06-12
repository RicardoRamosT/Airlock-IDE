import {
  access,
  cp,
  link,
  mkdir,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { resolveWithin } from "./tree";

// All ops are path-confined: resolveWithin throws if relPath escapes root.
// ASCII-only file (bundled into the Electron CJS main).

async function exists(abs: string): Promise<boolean> {
  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}

// Create an empty file. Fails if it exists; the parent dir must already exist.
export async function createFile(root: string, relPath: string): Promise<void> {
  const abs = await resolveWithin(root, relPath);
  if (await exists(abs)) throw new Error(`Already exists: ${relPath}`);
  await writeFile(abs, "", { encoding: "utf8", flag: "wx" });
}

// Create a directory. Fails if it exists.
export async function createDir(root: string, relPath: string): Promise<void> {
  const abs = await resolveWithin(root, relPath);
  if (await exists(abs)) throw new Error(`Already exists: ${relPath}`);
  await mkdir(abs);
}

// Rename or move (file or dir). Fails if the destination exists -- WITHOUT a
// silent clobber. A bare rename() overwrites the destination, so the old
// exists()-then-rename had a TOCTOU window in which a file created in between was
// silently destroyed. link() is an ATOMIC no-clobber (it fails with EEXIST if the
// destination exists) for a regular file on the same device, so use it then drop
// the source; on EXDEV/EPERM/EISDIR (a directory or a cross-device move) fall
// back to the checked rename, whose residual race is bounded by the file tree's
// serial, single-user operations. (audit M9)
export async function move(
  root: string,
  fromRel: string,
  toRel: string,
): Promise<void> {
  const fromAbs = await resolveWithin(root, fromRel);
  const toAbs = await resolveWithin(root, toRel);
  try {
    await link(fromAbs, toAbs);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw new Error(`Already exists: ${toRel}`);
    if (code === "EXDEV" || code === "EPERM" || code === "EISDIR") {
      // Directory or cross-device: link cannot help; checked rename.
      if (await exists(toAbs)) throw new Error(`Already exists: ${toRel}`);
      await rename(fromAbs, toAbs);
      return;
    }
    throw e; // ENOENT (missing source/parent) etc. -- surface as-is
  }
  await unlink(fromAbs);
}

// Copy a file or dir to "<name> copy<.ext>", incrementing until free. Returns
// the new relPath (so the caller can reveal/select it).
export async function duplicate(
  root: string,
  relPath: string,
): Promise<string> {
  const abs = await resolveWithin(root, relPath);
  const dir = path.dirname(relPath);
  const ext = path.extname(relPath);
  const base = path.basename(relPath, ext);
  const candidate = (n: number): string => {
    const suffix = n === 1 ? "copy" : `copy ${n}`;
    const name = `${base} ${suffix}${ext}`;
    return dir === "." ? name : path.join(dir, name);
  };
  let n = 1;
  let outRel = candidate(n);
  while (await exists(await resolveWithin(root, outRel))) {
    n += 1;
    outRel = candidate(n);
  }
  // errorOnExist + force:false so a destination that appears after the loop
  // picked a free name (or any pre-existing path under it) makes cp THROW rather
  // than silently overwrite/merge into it. (audit M10)
  await cp(abs, await resolveWithin(root, outRel), {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  return outRel;
}

export interface ImportExternalResult {
  imported: string[];
  failed: { name: string; error: string }[];
}

// Pick a name not in `taken`, appending " 2", " 3", ... before the extension
// (Finder's keep-both scheme). path.extname treats a dotfile (".env") and an
// extensionless folder as having no extension, so they get " 2" appended whole.
export function uniqueName(desired: string, taken: Set<string>): string {
  if (!taken.has(desired)) return desired;
  const ext = path.extname(desired);
  const base = path.basename(desired, ext);
  let n = 2;
  for (;;) {
    const candidate = `${base} ${n}${ext}`;
    if (!taken.has(candidate)) return candidate;
    n += 1;
  }
}

// Copy external (absolute) paths INTO destRel within root. Each source keeps its
// basename unless it clashes with an existing dest entry or a name already taken
// earlier in this batch, in which case uniqueName renames it (keep-both, never
// overwrite). Folders copy recursively. A source that throws (missing/unreadable)
// is recorded in `failed` and the loop continues. destRel is confined by
// resolveWithin; the caller (main IPC) additionally blocks the vault dir.
export async function importExternal(
  root: string,
  destRel: string,
  srcPaths: string[],
): Promise<ImportExternalResult> {
  const destAbs = await resolveWithin(root, destRel);
  const taken = new Set<string>(await readdir(destAbs).catch(() => []));
  const imported: string[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const src of srcPaths) {
    const base = path.basename(src);
    const name = uniqueName(base, taken);
    try {
      // errorOnExist + force:false: uniqueName already guarantees a free name,
      // so this only fires on a race -- in which case THROW rather than clobber.
      // dereference:true so a dragged symlink (or one inside a dragged folder)
      // is copied as the REAL file -- an import yields a self-contained copy
      // that lives in the project, not a pointer back out to the source.
      await cp(src, path.join(destAbs, name), {
        recursive: true,
        errorOnExist: true,
        force: false,
        dereference: true,
      });
      taken.add(name);
      imported.push(name);
    } catch (e) {
      failed.push({
        name: base,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { imported, failed };
}
