import {
  parseBranches,
  parseConnectionUri,
  parseDatabases,
  parseProjects,
} from "./parse";

const NEON_API_BASE = "https://console.neon.tech/api/v2";

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

export async function listProjects(
  key: string,
  opts: NeonOptions = {},
): Promise<NeonProject[]> {
  const t = opts.transport ?? fetchTransport;
  return parseProjects(await t.get("/projects", key));
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
