import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** Names and metadata ONLY. Secret values never appear in this file. */
export interface SecretMeta {
  name: string;
  provider: string | null;
  valid: boolean;
  createdAt: string;
  updatedAt: string;
}

function metaFile(root: string): string {
  return path.join(root, ".airlock", "secrets.json");
}

export async function readMeta(root: string): Promise<SecretMeta[]> {
  try {
    const text = await readFile(metaFile(root), "utf8");
    return JSON.parse(text) as SecretMeta[];
  } catch {
    return [];
  }
}

async function writeMetaList(root: string, list: SecretMeta[]): Promise<void> {
  const file = metaFile(root);
  await mkdir(path.dirname(file), { recursive: true });
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  try {
    await copyFile(file, `${file}.bak`);
  } catch {
    // No existing file yet - first write has nothing to back up.
  }
  await rename(tmp, file);
}

export async function upsertMeta(
  root: string,
  meta: SecretMeta,
): Promise<void> {
  const list = await readMeta(root);
  const next = list.filter((m) => m.name !== meta.name);
  next.push(meta);
  await writeMetaList(root, next);
}

export async function removeMeta(root: string, name: string): Promise<void> {
  const list = await readMeta(root);
  await writeMetaList(
    root,
    list.filter((m) => m.name !== name),
  );
}
