// Multi-account Neon pool (MAIN-ONLY). Each account = an API key (in the
// keychain, keyed by the Neon user id) + a non-secret {id,label} reference in a
// userData registry file so the pool is enumerable without reading keys.
// Projects bind to an account id (ProjectConfig.neonAccountId); resolution +
// the sole-account default are the pure resolveNeonAccountId in agent-core.
//
// SECURITY: keys never leave main; listNeonAccounts/resolve* return refs/ids
// only. The pure logic is unit-tested in agent-core; this IO edge is thin.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  deleteGlobalSecret,
  getGlobalSecret,
  type NeonAccountRef,
  neonAccountLabel,
  neonGetCurrentUser,
  readProjectConfig,
  resolveNeonAccountId,
  setGlobalSecret,
} from "@airlock/agent-core";
import { app } from "electron";

const LEGACY_KEY = "NEON_API_KEY"; // the pre-multi-account single global key

const registryFile = () =>
  path.join(app.getPath("userData"), "neon-accounts.json");
const auditLog = () => path.join(app.getPath("userData"), "audit-global.jsonl");
// Keychain global-secret name holding one account's API key.
const keyName = (id: string) => `neon-account:${id}`;

async function readRegistry(): Promise<NeonAccountRef[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(registryFile(), "utf8"));
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (a): a is NeonAccountRef =>
          !!a &&
          typeof (a as NeonAccountRef).id === "string" &&
          typeof (a as NeonAccountRef).label === "string",
      );
    }
  } catch {
    // missing / malformed -> an empty pool
  }
  return [];
}

async function writeRegistry(refs: NeonAccountRef[]): Promise<void> {
  await writeFile(registryFile(), `${JSON.stringify(refs, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

// One-time fold of the legacy single NEON_API_KEY into the pool, when the
// registry is empty. If the key identifies (personal/org), it becomes a labeled
// account; if it can't (e.g. project-scoped 404), it's kept under a synthetic
// id so the user's existing connection survives the upgrade.
let migrated = false;
async function migrateLegacy(): Promise<void> {
  if (migrated) return;
  migrated = true;
  if ((await readRegistry()).length > 0) return;
  const legacy = await getGlobalSecret(LEGACY_KEY);
  if (!legacy) return;
  let ref: NeonAccountRef;
  try {
    const user = await neonGetCurrentUser(legacy);
    ref = { id: user.id || "legacy", label: neonAccountLabel(user) };
  } catch {
    ref = { id: "legacy", label: "Neon (existing key)" };
  }
  await setGlobalSecret(keyName(ref.id), legacy, { auditLog: auditLog() });
  await writeRegistry([ref]);
  await deleteGlobalSecret(LEGACY_KEY, { auditLog: auditLog() });
}

export async function listNeonAccounts(): Promise<NeonAccountRef[]> {
  await migrateLegacy();
  return readRegistry();
}

// Add a key to the pool, identifying its account via /users/me. A project-scoped
// key can't identify itself (404) and isn't a valid pool account -> clear error.
export async function addNeonAccount(key: string): Promise<NeonAccountRef> {
  await migrateLegacy();
  let user: Awaited<ReturnType<typeof neonGetCurrentUser>>;
  try {
    user = await neonGetCurrentUser(key);
  } catch {
    throw new Error(
      "Couldn't identify this key's Neon account — use a personal or organization API key (a project-scoped key can't be added).",
    );
  }
  if (!user.id)
    throw new Error("Neon did not return an account id for this key.");
  const ref: NeonAccountRef = { id: user.id, label: neonAccountLabel(user) };
  await setGlobalSecret(keyName(ref.id), key.trim(), { auditLog: auditLog() });
  const refs = (await readRegistry()).filter((a) => a.id !== ref.id);
  refs.push(ref);
  await writeRegistry(refs);
  return ref;
}

export async function removeNeonAccount(id: string): Promise<void> {
  await deleteGlobalSecret(keyName(id), { auditLog: auditLog() });
  await writeRegistry((await readRegistry()).filter((a) => a.id !== id));
}

export function keyForAccount(id: string): Promise<string | null> {
  return getGlobalSecret(keyName(id));
}

// The account a project resolves to (binding -> sole-account default -> null).
export async function resolveProjectAccountId(
  root: string | null,
): Promise<string | null> {
  const accounts = await listNeonAccounts();
  const bound = root
    ? ((await readProjectConfig(root)).neonAccountId ?? null)
    : null;
  return resolveNeonAccountId(bound, accounts);
}

// The API key a project's Neon calls should use (null when no account resolves).
export async function keyForProject(
  root: string | null,
): Promise<string | null> {
  const id = await resolveProjectAccountId(root);
  return id ? keyForAccount(id) : null;
}
