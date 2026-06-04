import { readFile, unlink } from "node:fs/promises";
import { appendAudit } from "../audit/audit";
import { projectIdFor } from "../project/id";
import { resolveWithin } from "../workspace/tree";
import { isDangerousEnvName } from "./dangerous";
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
  // Reject reserved/dangerous names at store time. filterDangerousEnv would
  // silently strip these from injection, so vaulting one would create a
  // secret that never injects - an explicit error is clearer than that.
  if (isDangerousEnvName(name))
    throw new Error(`Reserved env name cannot be vaulted: ${name}`);
  const validation = validateSecret(name, value);
  const existing = (await readMeta(root)).find((m) => m.name === name);
  const now = new Date().toISOString();
  const meta: SecretMeta = {
    name,
    provider: validation.provider,
    valid: validation.valid,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  // Write meta BEFORE the keychain value. If we crash between the two, the
  // gentler degrade is a meta entry whose value inject reports as "missing"
  // (already handled, and the user sees it in the list to retry/delete) rather
  // than a silent keychain orphan with no meta. If keychain.set throws here,
  // the meta is already persisted - an acceptable degrade for the same reason.
  await upsertMeta(root, meta);
  keychain.set(SERVICE, await accountFor(root, name), value);
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
  // Capture whether the OS delete actually removed a credential. We still
  // remove the meta entry regardless (the user wants it gone from the list),
  // but record the truth: keychainDeleted:false means a value may linger in
  // the OS keychain (locked store, or it was already absent). The audit stays
  // honest instead of always claiming a clean delete.
  const deleted = keychain.delete(SERVICE, await accountFor(root, name));
  await removeMeta(root, name);
  await appendAudit(root, "user", "secret.delete", {
    name,
    keychainDeleted: deleted,
  });
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
  if (opts.deleteAfter && imported.length > 0 && skipped.length === 0) {
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
