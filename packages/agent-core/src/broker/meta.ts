import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureAirlockDir } from "../project/airlockDir";

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

function isSecretMeta(x: unknown): x is SecretMeta {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as { name?: unknown }).name === "string"
  );
}

export async function readMeta(root: string): Promise<SecretMeta[]> {
  let text: string;
  try {
    text = await readFile(metaFile(root), "utf8");
  } catch {
    // Missing/unreadable file = no secrets vaulted yet (the legitimate empty
    // case). Only THIS returns [].
    return [];
  }
  // The file EXISTS, so a parse failure or a non-array/malformed shape is
  // CORRUPTION, not "empty". Fail loud instead of silently returning [] -- a
  // silent [] makes the secrets look gone AND the next write would copy the
  // corrupt file over the .bak and persist the degraded list, permanently
  // losing the name index. Throwing makes every secret op fail closed and
  // preserves both secrets.json and its .bak for recovery. (audit M7/M8)
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      "secrets.json is corrupt (invalid JSON) -- not overwriting; restore from .airlock/secrets.json.bak",
    );
  }
  if (!Array.isArray(parsed) || !parsed.every(isSecretMeta)) {
    throw new Error(
      "secrets.json is corrupt (expected a JSON array of secret entries) -- not overwriting; restore from .airlock/secrets.json.bak",
    );
  }
  return parsed;
}

let metaTmpSeq = 0;
const nextMetaTmpId = () =>
  `${Date.now().toString(36)}${(metaTmpSeq++).toString(36)}`;

async function writeMetaList(root: string, list: SecretMeta[]): Promise<void> {
  const file = metaFile(root);
  await ensureAirlockDir(root); // create .airlock + drop the ignore-all .gitignore
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
  // Unique per write. A FIXED `${file}.tmp` is shared by every concurrent
  // writer, so two overlapping upserts interleave into one temp file and the
  // rename publishes a torn result -- which readMeta then THROWS on, wedging
  // every secret operation in that project. writeProjectConfig already learned
  // this; this store had not.
  const tmp = `${file}.${process.pid}.${nextMetaTmpId()}.tmp`;
  // This is a names-only index (no secret values ever land here), but write it
  // owner-only (0o600) for least privilege anyway. macOS honors the mode; the
  // mode is set on the tmp file and preserved across the atomic rename.
  await writeFile(tmp, `${JSON.stringify(sorted, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    await copyFile(file, `${file}.bak`);
  } catch {
    // No existing file yet - first write has nothing to back up.
  }
  await rename(tmp, file);
}

// ONE IN-FLIGHT WRITE PER ROOT, chained.
//
// upsertMeta and removeMeta are read-modify-write: read the index, change one
// entry, write it all back. Two concurrent calls both read the SAME baseline
// and the last rename wins, so the other's secret vanishes from the index --
// its keychain value is then orphaned and the user sees the secret disappear
// from the list. Importing a .env file upserts every name at once, which is
// exactly the concurrent case.
//
// writeProjectConfig already does this (and its comment names the same race);
// this store never adopted it. Chaining makes each read happen only after the
// previous rename has landed.
const metaQueues = new Map<string, Promise<unknown>>();

function chainMeta<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const prev = metaQueues.get(root) ?? Promise.resolve();
  // Run on both settle paths, so one failed write cannot wedge the queue.
  const run = prev.then(fn, fn);
  metaQueues.set(
    root,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

export async function upsertMeta(
  root: string,
  meta: SecretMeta,
): Promise<void> {
  return chainMeta(root, async () => {
    const list = await readMeta(root);
    const next = list.filter((m) => m.name !== meta.name);
    next.push(meta);
    await writeMetaList(root, next);
  });
}

export async function removeMeta(root: string, name: string): Promise<void> {
  return chainMeta(root, async () => {
    const list = await readMeta(root);
    await writeMetaList(
      root,
      list.filter((m) => m.name !== name),
    );
  });
}
