import {
  parseBranches,
  parseConnectionUri,
  parseDatabases,
  parseFirstProjectOrgId,
  parseOrg,
  parseOrganizations,
  parseProjects,
  parseUser,
} from "./parse";

const NEON_API_BASE = "https://console.neon.tech/api/v2";

// The account a Neon API key authenticates as. `id` is the stable Neon user id
// (used as the account key in AirLock's multi-account pool); email/name are for
// a human-readable label.
export interface NeonUser {
  id: string;
  email: string;
  name: string;
}
// A connected Neon account in AirLock's pool: a stable id + a display label.
// The API key itself lives in the keychain, keyed by id; this is the non-secret
// reference the UI lists and that projects bind to.
export interface NeonAccountRef {
  id: string;
  label: string;
}

// Which account a project uses: its explicit binding when that account still
// exists, else the sole account when exactly one is connected (so a
// single-account setup needs no per-project choice), else null (user must pick).
export function resolveNeonAccountId(
  boundId: string | null,
  accounts: NeonAccountRef[],
): string | null {
  if (boundId && accounts.some((a) => a.id === boundId)) return boundId;
  if (accounts.length === 1) return accounts[0]?.id ?? null;
  return null;
}

export interface NeonOrg {
  id: string;
  name: string;
}
export interface NeonProject {
  id: string;
  name: string;
}
export interface NeonBranch {
  id: string;
  name: string;
}
export interface NeonDatabase {
  name: string;
  ownerName: string;
}

// DI transport so the HTTP edge is swappable in tests. The real adapter uses
// the global fetch in the Electron/Node main process.
export interface NeonTransport {
  get(path: string, key: string): Promise<unknown>;
}
export interface NeonOptions {
  transport?: NeonTransport;
}

export const fetchTransport: NeonTransport = {
  async get(path, key) {
    const res = await fetch(`${NEON_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Neon API ${res.status} ${res.statusText}`);
    return res.json();
  },
};

const enc = encodeURIComponent;

// The account a key authenticates as (GET /users/me). Used to label the key in
// the multi-account pool. A project-scoped key may 404 here; callers handle it.
export async function getCurrentUser(
  key: string,
  opts: NeonOptions = {},
): Promise<NeonUser> {
  const t = opts.transport ?? fetchTransport;
  return parseUser(await t.get("/users/me", key));
}

// A human-readable label for a Neon account: email, else full name, else a
// short id fragment, else a generic fallback. Pure.
export function neonAccountLabel(u: NeonUser): string {
  return (
    u.email || u.name || (u.id ? `Neon ${u.id.slice(0, 8)}` : "Neon account")
  );
}

// Identify an ORGANIZATION key (which 404s on /users/me): its org is inferred
// from the first project's org_id, then named via the org details. Returns null
// when the key can't list projects (project-scoped) or has none. The org
// details call is best-effort — on failure the org_id stands in as the name.
export async function getInferredOrg(
  key: string,
  opts: NeonOptions = {},
): Promise<NeonOrg | null> {
  const t = opts.transport ?? fetchTransport;
  let orgId: string;
  try {
    orgId = parseFirstProjectOrgId(await t.get("/projects?limit=1", key));
  } catch {
    return null; // can't list projects -> not an org key we can identify
  }
  if (!orgId) return null;
  let name = "";
  try {
    name =
      parseOrg(await t.get(`/organizations/${enc(orgId)}`, key))?.name ?? "";
  } catch {
    // best-effort name; the id stands in below
  }
  return { id: orgId, name };
}

// The organizations the API key's user belongs to. Requires a PERSONAL API key
// (a project-scoped key has no access to this and 404s). Neon migrated all
// accounts to organizations, so projects are enumerated per org.
export async function listOrganizations(
  key: string,
  opts: NeonOptions = {},
): Promise<NeonOrg[]> {
  const t = opts.transport ?? fetchTransport;
  return parseOrganizations(await t.get("/users/me/organizations", key));
}

// Projects within an organization. A personal key must scope by org_id; an
// organization key infers its org, so pass "" to omit the filter and list via
// plain `/projects` (the inferred-org path).
export async function listProjects(
  key: string,
  orgId: string,
  opts: NeonOptions = {},
): Promise<NeonProject[]> {
  const t = opts.transport ?? fetchTransport;
  const path = orgId ? `/projects?org_id=${enc(orgId)}` : "/projects";
  return parseProjects(await t.get(path, key));
}
export async function listBranches(
  key: string,
  projectId: string,
  opts: NeonOptions = {},
): Promise<NeonBranch[]> {
  const t = opts.transport ?? fetchTransport;
  return parseBranches(
    await t.get(`/projects/${enc(projectId)}/branches`, key),
  );
}
export async function listDatabases(
  key: string,
  projectId: string,
  branchId: string,
  opts: NeonOptions = {},
): Promise<NeonDatabase[]> {
  const t = opts.transport ?? fetchTransport;
  return parseDatabases(
    await t.get(
      `/projects/${enc(projectId)}/branches/${enc(branchId)}/databases`,
      key,
    ),
  );
}
// MAIN-ONLY: returns a connstring WITH password. NEVER return this over IPC.
export async function neonConnectionUri(
  key: string,
  projectId: string,
  branchId: string,
  database: string,
  role: string,
  opts: NeonOptions = {},
): Promise<string> {
  const t = opts.transport ?? fetchTransport;
  const q = new URLSearchParams({
    branch_id: branchId,
    database_name: database,
    role_name: role,
    pooled: "false",
  });
  return parseConnectionUri(
    await t.get(
      `/projects/${enc(projectId)}/connection_uri?${q.toString()}`,
      key,
    ),
  );
}
