import { readdir, readFile, unlink } from "node:fs/promises";
import { appendAudit, appendAuditAt } from "../audit/audit";
import { projectIdFor } from "../project/id";
import { resolveWithin } from "../workspace/tree";
import { isDangerousEnvName } from "./dangerous";
import { parseDotEnv } from "./dotenv";
import { isImportableEnvFile, sortEnvFiles } from "./envFiles";
import { type KeychainStore, systemKeychain } from "./keychain";
import { readMeta, removeMeta, type SecretMeta, upsertMeta } from "./meta";
import { validateSecret, validateSecretName } from "./validators";

const SERVICE = "airlock";

export interface BrokerOptions {
  keychain?: KeychainStore;
  // Audit attribution for the operation. The IPC/button paths keep the
  // default; the MCP import_env tool passes "agent" so the chain is honest.
  actor?: "user" | "agent";
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
  // Reject an empty/whitespace-only value. validateSecret is advisory (never
  // gates), so without this an empty "secret" would be vaulted -- meaningless,
  // and a whitespace-only value is UNREDACTABLE (the redactor skips
  // whitespace-only values), so it could surface verbatim in output. (audit L7)
  if (value.trim().length === 0)
    throw new Error("Secret value cannot be empty");
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
  await appendAudit(root, opts.actor ?? "user", "secret.set", {
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
  await appendAudit(root, opts.actor ?? "user", "secret.delete", {
    name,
    keychainDeleted: deleted,
  });
}

export async function listSecrets(root: string): Promise<SecretMeta[]> {
  return readMeta(root);
}

// ===========================================================================
// !!! MAIN-ONLY -- THE SINGLE BY-NAME VALUE PATH OUT OF THE BROKER !!!
// ---------------------------------------------------------------------------
// getSecretValue returns a secret's RAW value (e.g. a full Postgres
// connection string, password and all) so the app can use it LOCALLY in the
// main process -- for instance, opening a DB connection the user asked to
// browse. This is the ONE place a credential leaves the broker keyed by name.
//
//   * NEVER register this as an agent/MCP tool.
//   * The ONLY renderer IPC that may return this is the explicit, OWNER-triggered
//     secrets:reveal / clipboard:copySecret in app main/ipc.ts (audited, name
//     only; the agent process cannot reach renderer IPC). Do NOT add others.
//   * Only main-side connection handlers may call it; the renderer/agent get
//     host / database / table / row data ONLY -- never the credential itself.
//
// Every other broker accessor (listSecrets/injectInto) is metadata- or
// env-injection-scoped on purpose. If you find yourself wanting this value
// anywhere outside main's DB connection code, STOP -- you almost certainly
// want a redacted projection instead.
// ===========================================================================
export async function getSecretValue(
  root: string,
  name: string,
  opts: BrokerOptions = {},
): Promise<string | null> {
  const keychain = opts.keychain ?? systemKeychain;
  return keychain.get(SERVICE, await accountFor(root, name));
}

// Gather every vaulted secret as { name, value } pairs (main-only; reads the
// keychain). The named counterpart of the value-only gather used for redaction.
export async function vaultedSecrets(
  root: string,
  opts: BrokerOptions = {},
): Promise<{ name: string; value: string }[]> {
  const metas = await listSecrets(root);
  const out: { name: string; value: string }[] = [];
  for (const m of metas) {
    const v = await getSecretValue(root, m.name, opts);
    if (v) out.push({ name: m.name, value: v });
  }
  return out;
}

// Reserved app-global keychain namespace. accountFor() yields "<id>:<name>"
// where id is "<basename>-<8hex>" -- never starts with "@" nor contains "/",
// so "@global/<name>" can never collide with a project secret account.
function globalAccountFor(name: string): string {
  return `@global/${name}`;
}

// ===========================================================================
// !!! MAIN-ONLY -- APP-GLOBAL BY-NAME VALUE PATH OUT OF THE BROKER !!!
// ---------------------------------------------------------------------------
// getGlobalSecret returns an account-level credential's RAW value (e.g. a Neon
// or Render API key) so main can use it LOCALLY -- for instance, calling the
// Neon API on the user's behalf. Account-level keys are not tied to one
// project, hence the "@global" namespace instead of a projectId scope. This is
// the SAME hard rule as getSecretValue:
//
//   * NEVER register this as an agent tool.
//   * NEVER return its result over renderer IPC.
//   * Only main-side handlers may call it; the renderer/agent get derived,
//     redacted data ONLY -- never the credential itself.
//
// If you find yourself wanting this value anywhere outside main, STOP -- you
// almost certainly want a redacted projection instead.
// ===========================================================================
export async function getGlobalSecret(
  name: string,
  opts: BrokerOptions = {},
): Promise<string | null> {
  const keychain = opts.keychain ?? systemKeychain;
  return keychain.get(SERVICE, globalAccountFor(name));
}

// Vault an app-global secret. Write-only from the renderer's view. Audited to
// the app-global chain when auditLog is provided (main passes the userData log
// path, since a global write can happen with no project folder open).
export async function setGlobalSecret(
  name: string,
  value: string,
  opts: BrokerOptions & { auditLog?: string } = {},
): Promise<void> {
  const keychain = opts.keychain ?? systemKeychain;
  // Same empty/whitespace guard as setSecret (an unredactable value otherwise).
  if (value.trim().length === 0) throw new Error("Empty secret value");
  keychain.set(SERVICE, globalAccountFor(name), value);
  if (opts.auditLog) {
    await appendAuditAt(
      opts.auditLog,
      opts.actor ?? "user",
      "secret.global.set",
      { name },
    );
  }
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
  await appendAudit(root, opts.actor ?? "user", "secret.inject", {
    names: injected,
    missing,
    count: injected.length,
  });
  return { env, injected, missing };
}

export interface ImportResult {
  imported: SecretMeta[];
  skipped: string[];
  // Names whose setSecret threw mid-loop (e.g. a reserved name like PATH, or a
  // locked keychain). Distinct from `skipped` (rejected before any write).
  failed: string[];
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
  const failed: string[] = [];
  for (const [name, value] of Object.entries(pairs)) {
    if (!validateSecretName(name) || value.length === 0) {
      skipped.push(name);
      continue;
    }
    // A single setSecret failure must not abort the loop and lose the summary
    // audit. Record the name in `failed` and continue so the trail is honest.
    try {
      imported.push(await setSecret(root, name, value, opts));
    } catch {
      failed.push(name);
    }
  }
  // Never delete the source file unless EVERY entry made it (no skips, no
  // failures) - otherwise an unrecoverable secret would be silently dropped.
  let deleted = false;
  if (
    opts.deleteAfter &&
    imported.length > 0 &&
    skipped.length === 0 &&
    failed.length === 0
  ) {
    await unlink(abs);
    deleted = true;
  }
  await appendAudit(root, opts.actor ?? "user", "secret.import", {
    file: relPath,
    imported: imported.map((m) => m.name),
    skipped,
    failed,
    deleted,
  });
  return { imported, skipped, failed, deleted };
}

// One batch-import entry: either a per-file ImportResult or the error that
// file hit (unreadable, EISDIR, resolveWithin rejection). Carries secret
// NAMES only — safe to cross IPC/MCP.
export interface EnvFileImport {
  file: string;
  result?: ImportResult;
  error?: string;
}

// Import EVERY importable env file in the project root (non-recursive).
// Default mode discovers with isImportableEnvFile + sortEnvFiles (last write
// wins, so .local files override shared ones on duplicate keys). opts.files
// (the MCP tool's explicit mode) skips discovery AND the exclusion predicate:
// exactly the given relative paths, in the given order — each still confined
// to the root by importDotEnv's resolveWithin. One bad file becomes an
// `error` entry and the loop continues; per-file auditing and the
// delete-only-if-fully-imported rule stay inside importDotEnv.
export async function importAllDotEnv(
  root: string,
  opts: BrokerOptions & { deleteAfter?: boolean; files?: string[] } = {},
): Promise<EnvFileImport[]> {
  let files: string[];
  if (opts.files) {
    files = opts.files;
  } else {
    const entries = await readdir(root, { withFileTypes: true });
    files = sortEnvFiles(
      entries
        .filter((e) => e.isFile() && isImportableEnvFile(e.name))
        .map((e) => e.name),
    );
  }
  const out: EnvFileImport[] = [];
  for (const file of files) {
    try {
      out.push({ file, result: await importDotEnv(root, file, opts) });
    } catch (e) {
      out.push({ file, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
