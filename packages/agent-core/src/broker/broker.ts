import { readFile, unlink } from "node:fs/promises";
import { appendAudit } from "../audit/audit";
import { projectIdFor } from "../project/id";
import { resolveWithin } from "../workspace/tree";
import { parseDotEnv } from "./dotenv";
import { type KeychainStore, systemKeychain } from "./keychain";
import { readMeta, removeMeta, type SecretMeta, upsertMeta } from "./meta";
import { validateSecret, validateSecretName } from "./validators";

const SERVICE = "airlock";

export interface BrokerOptions {
  keychain?: KeychainStore;
}

async function accountFor(root: string, name: string): Promise<string> {
  return `${await projectIdFor(root)}:${name}`;
}

export async function setSecret(
  root: string,
  name: string,
  value: string,
  opts: BrokerOptions = {},
): Promise<SecretMeta> {
  const keychain = opts.keychain ?? systemKeychain;
  if (!validateSecretName(name))
    throw new Error(`Invalid secret name: ${name}`);
  const validation = validateSecret(name, value);
  const existing = (await readMeta(root)).find((m) => m.name === name);
  const now = new Date().toISOString();
  keychain.set(SERVICE, await accountFor(root, name), value);
  const meta: SecretMeta = {
    name,
    provider: validation.provider,
    valid: validation.valid,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await upsertMeta(root, meta);
  await appendAudit(root, "user", "secret.set", {
    name,
    provider: validation.provider,
    valid: validation.valid,
  });
  return meta;
}

export async function deleteSecret(
  root: string,
  name: string,
  opts: BrokerOptions = {},
): Promise<void> {
  const keychain = opts.keychain ?? systemKeychain;
  keychain.delete(SERVICE, await accountFor(root, name));
  await removeMeta(root, name);
  await appendAudit(root, "user", "secret.delete", { name });
}

export async function listSecrets(root: string): Promise<SecretMeta[]> {
  return readMeta(root);
}

export interface InjectResult {
  env: Record<string, string>;
  injected: string[];
  missing: string[];
}

export async function injectInto(
  root: string,
  base: Record<string, string>,
  opts: BrokerOptions = {},
): Promise<InjectResult> {
  const keychain = opts.keychain ?? systemKeychain;
  const env = { ...base };
  const injected: string[] = [];
  const missing: string[] = [];
  for (const meta of await readMeta(root)) {
    const value = keychain.get(SERVICE, await accountFor(root, meta.name));
    if (value === null) {
      missing.push(meta.name);
      continue;
    }
    env[meta.name] = value;
    injected.push(meta.name);
  }
  await appendAudit(root, "user", "secret.inject", {
    names: injected,
    missing,
    count: injected.length,
  });
  return { env, injected, missing };
}

export interface ImportResult {
  imported: SecretMeta[];
  skipped: string[];
  deleted: boolean;
}

export async function importDotEnv(
  root: string,
  relPath: string,
  opts: BrokerOptions & { deleteAfter?: boolean } = {},
): Promise<ImportResult> {
  const abs = await resolveWithin(root, relPath);
  const text = await readFile(abs, "utf8");
  const pairs = parseDotEnv(text);
  const imported: SecretMeta[] = [];
  const skipped: string[] = [];
  for (const [name, value] of Object.entries(pairs)) {
    if (!validateSecretName(name) || value.length === 0) {
      skipped.push(name);
      continue;
    }
    imported.push(await setSecret(root, name, value, opts));
  }
  let deleted = false;
  if (opts.deleteAfter && imported.length > 0) {
    await unlink(abs);
    deleted = true;
  }
  await appendAudit(root, "user", "secret.import", {
    file: relPath,
    imported: imported.map((m) => m.name),
    skipped,
    deleted,
  });
  return { imported, skipped, deleted };
}
