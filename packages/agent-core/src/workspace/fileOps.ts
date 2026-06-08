import { access, cp, mkdir, rename, writeFile } from "node:fs/promises";
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

// Rename or move (file or dir). Fails if the destination exists.
export async function move(
  root: string,
  fromRel: string,
  toRel: string,
): Promise<void> {
  const fromAbs = await resolveWithin(root, fromRel);
  const toAbs = await resolveWithin(root, toRel);
  if (await exists(toAbs)) throw new Error(`Already exists: ${toRel}`);
  await rename(fromAbs, toAbs);
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
  await cp(abs, await resolveWithin(root, outRel), { recursive: true });
  return outRel;
}
