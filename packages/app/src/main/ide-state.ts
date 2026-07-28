// Shared IDE status-read layer. MAIN-ONLY. Every function here is called by the
// renderer IPC handlers (main/ipc.ts) AND, in a later task, by the MCP tools so
// there is ONE implementation of each read. The bodies were extracted verbatim
// from the matching ipc.ts handlers (parameterized on root / prefsFile) so the
// renderer-facing response shapes are byte-identical to before.
//
// SECURITY INVARIANT: NO secret value may escape any function in this file.
//   - databaseStatus uses parseConnString's redacted projection only.
//   - neon*/render* return metadata only (the API key + any resolved
//     connection URI that carries a password stay main-only).
//   - listSecretNames returns names / provider / valid only (no values).
//   - the reachability probe in databaseStatus wraps withDb in try/catch and
//     NEVER includes the connection string or the error in its result.
//
// ASCII-only comments: this module is CJS-bundled into the Electron main process
// and Electron's cjs_lexer crashes on multibyte characters.

import type { ExtensionSummary } from "@airlock/agent-core";
import {
  type DbTable,
  type DockerStatus,
  databaseContainers,
  diffEnvVars,
  dockerContainers,
  dockerEnv,
  dockerPostgresUrl,
  type EnvDiffEntry,
  type GitStatus,
  getGlobalSecret,
  getSecretValue,
  gitStatus,
  headSha,
  LIST_DATABASES_SQL,
  listSecrets,
  listTables,
  type NeonBranch,
  type NeonDatabase,
  type NeonOrg,
  type NeonProject,
  neonListBranches,
  neonListDatabases,
  neonListOrganizations,
  neonListProjects,
  originRemoteUrl,
  parseConnString,
  pingDb,
  probePort,
  type QueryResult,
  type RenderDeploy,
  type RenderEnvVar,
  readProjectConfig,
  readRows,
  renderLatestDeploy,
  renderListDeploys,
  renderListEnvVars,
  renderListServices,
  renderTriggerDeploy,
  servicesForRepo,
  withDatabase,
  withDb,
} from "@airlock/agent-core";
import type { RenderServiceStatus, Section } from "../shared/ipc";
import { sectionLabel } from "./menu";
import { keyForProject } from "./neon/accounts";
import { BUILTIN_SECTIONS, loadPrefs } from "./prefs";

const RENDER_KEY = "RENDER_API_KEY";

// Sidebar sections with their app-global visibility, projected for display.
// Reads the persisted visibility map and maps it over the canonical section
// order with human labels. App-global (no root needed).
export async function listSidebarSections(
  prefsFile: string,
  exts: { id: string; name: string }[] = [],
): Promise<{ id: Section; label: string; visible: boolean }[]> {
  const prefs = await loadPrefs(prefsFile);
  const ids: Section[] = [
    ...BUILTIN_SECTIONS,
    ...exts.map((e) => `ext:${e.id}` as Section),
  ];
  return ids.map((id) => ({
    id,
    label: sectionLabel(id, exts),
    visible: prefs.sectionVisibility[id] !== false,
  }));
}

// Docker engine + container status. Machine-global (no root needed).
export function dockerStatus(): Promise<DockerStatus> {
  return dockerContainers();
}

// The REAL connection state of each section extension, for the hub.
//
// These rows used to carry a hardcoded `status: "ready"` from
// sectionExtensionSummaries, because agent-core's registry is pure and knows
// nothing about liveness -- so the hub could not honestly say whether Docker
// was running, and every surface special-cased the tier to avoid claiming it
// was. All three probes already existed in main (they back the docker:/neon:/
// render: IPCs); this just calls them together so the hub can bucket by
// connection state like every other row.
//
// Docker is the only one of the three that can be "installed but unusable"
// (daemon down) -- that is `unauthed` ("Not connected"), distinct from `absent`
// ("Not installed"). Neon and Render are an API key or nothing, so they never
// report absent. Snowflake/Azure are omitted deliberately: they are ALSO Tier-1
// manifests, whose detect status wins in mergeSectionExtensions.
export async function sectionExtensionStatuses(
  root: string | null,
): Promise<Record<string, ExtensionSummary["status"]>> {
  const settle = async (
    probe: () => Promise<ExtensionSummary["status"]>,
  ): Promise<ExtensionSummary["status"]> => probe().catch(() => "error");
  const [docker, neon, render] = await Promise.all([
    settle(async () => {
      const d = await dockerContainers();
      if (!d.installed) return "absent";
      return d.running ? "connected" : "unauthed";
    }),
    settle(async () =>
      (await keyForProject(root)) !== null ? "connected" : "unauthed",
    ),
    settle(async () =>
      (await getGlobalSecret(RENDER_KEY)) !== null ? "connected" : "unauthed",
    ),
  ]);
  return { docker, neon, render };
}

// Resolve the API key for the project's bound Neon account; throw if none
// resolves (no account, or unbound with multiple). All Neon reads go through
// this so each project uses ITS OWN account, never another project's.
async function neonKey(root: string | null): Promise<string> {
  const key = await keyForProject(root);
  if (!key) throw new Error("No Neon account selected for this project");
  return key;
}

// Whether the project resolves to a Neon account (with a key). Returns only a
// boolean; the key never leaves main.
export async function neonStatus(
  root: string | null,
): Promise<{ connected: boolean }> {
  return { connected: (await keyForProject(root)) !== null };
}

// The organizations to root the Neon tree at, for the project's account. Handles
// all three key types:
//   - personal key  -> /users/me/organizations lists the user's orgs.
//   - organization key -> that endpoint 404s (not a user endpoint), but the
//     org's projects list via the inferred /projects, so surface ONE synthetic
//     org node ("Your projects", id "") whose projects come from /projects.
//   - project-scoped key -> can't list either, so the probe below rethrows and
//     the UI shows the scoped-key hint instead of a raw 404.
export async function neonOrganizations(
  root: string | null,
): Promise<NeonOrg[]> {
  const key = await neonKey(root);
  try {
    const orgs = await neonListOrganizations(key);
    if (orgs.length > 0) return orgs;
  } catch {
    // Not a personal key; fall through to the organization-key path.
  }
  // Probe the inferred-org project list. Succeeds for an org key (-> synthetic
  // org); throws for a project-scoped key (-> propagates to the scoped hint).
  await neonListProjects(key, "");
  return [{ id: "", name: "Your projects" }];
}

// Neon projects within an organization (metadata only), for the project's
// account. The API key stays main-only.
export async function neonProjects(
  root: string | null,
  orgId: string,
): Promise<NeonProject[]> {
  return neonListProjects(await neonKey(root), orgId);
}

// Neon branches for a project (metadata only).
export async function neonBranches(
  root: string | null,
  p: string,
): Promise<NeonBranch[]> {
  return neonListBranches(await neonKey(root), p);
}

// Neon databases for a project/branch (metadata only).
export async function neonDatabases(
  root: string | null,
  p: string,
  b: string,
): Promise<NeonDatabase[]> {
  return neonListDatabases(await neonKey(root), p, b);
}

// Render services enriched with deploy state, filtered to this project's repo.
// App-global key stays main-only; returns an id/name/url/branch/deployStatus/
// deployed projection with NO key and NO secrets.
export async function renderServicesStatus(
  root: string | null,
): Promise<RenderServiceStatus[]> {
  const key = await getGlobalSecret(RENDER_KEY);
  if (!key) throw new Error("Render not connected");
  // Scope to THIS project's repo: a Render service always deploys from a git
  // repo, so show only services whose repo matches the project's origin remote.
  // No origin / no match => this project isn't deployed on Render => show none,
  // rather than leaking every account service into an unrelated project.
  const services = root
    ? servicesForRepo(
        await renderListServices(key),
        await originRemoteUrl(root),
      )
    : [];
  // Local HEAD sha for the deployed-vs-HEAD comparison (best effort).
  let localSha = "";
  if (root) {
    try {
      localSha = await headSha(root);
    } catch {
      localSha = "";
    }
  }
  const out: RenderServiceStatus[] = [];
  for (const s of services) {
    let deployStatus = "";
    let deployed: boolean | null = null;
    let lastDeploy: RenderDeploy | null = null;
    try {
      lastDeploy = await renderLatestDeploy(key, s.id);
      if (lastDeploy) {
        deployStatus = lastDeploy.status;
        // Compare with prefix tolerance: Render may report a short or full
        // commit sha vs the local full HEAD. null when either side is empty.
        deployed =
          localSha && lastDeploy.commit
            ? lastDeploy.commit === localSha ||
              lastDeploy.commit.startsWith(localSha) ||
              localSha.startsWith(lastDeploy.commit)
            : null;
      }
    } catch {
      deployStatus = "";
      lastDeploy = null;
    }
    out.push({
      id: s.id,
      name: s.name,
      url: s.url,
      branch: s.branch,
      deployStatus,
      deployed,
      type: s.type,
      region: s.region,
      plan: s.plan,
      autoDeploy: s.autoDeploy,
      dashboardUrl: s.dashboardUrl,
      lastDeploy,
    });
  }
  return out;
}

// Recent deploys for one service (lazy, fetched when a row is expanded).
export async function renderServiceDeploys(
  serviceId: string,
): Promise<RenderDeploy[]> {
  const key = await getGlobalSecret(RENDER_KEY);
  if (!key) throw new Error("Render not connected");
  return renderListDeploys(key, serviceId, 5);
}

// Ephemeral, main-only cache of a service's env vars. Values live ONLY here and
// in the renderer's transient reveal -- never persisted, never sent to the agent.
const renderEnvCache = new Map<string, RenderEnvVar[]>();

async function fetchRenderEnv(serviceId: string): Promise<RenderEnvVar[]> {
  const key = await getGlobalSecret(RENDER_KEY);
  if (!key) throw new Error("Render not connected");
  const vars = await renderListEnvVars(key, serviceId);
  renderEnvCache.set(serviceId, vars);
  return vars;
}

// Live: always refetch (and refresh the cache), return KEYS only (no values).
export async function renderServiceEnvKeys(
  serviceId: string,
): Promise<string[]> {
  const vars = await fetchRenderEnv(serviceId);
  return vars.map((v) => v.key).sort();
}

// Owner-only single value (the IPC layer audits the reveal). Uses the cache,
// refetching if a key was never listed.
export async function renderServiceEnvReveal(
  serviceId: string,
  envKey: string,
): Promise<string | null> {
  const vars =
    renderEnvCache.get(serviceId) ?? (await fetchRenderEnv(serviceId));
  return vars.find((v) => v.key === envKey)?.value ?? null;
}

// Value-free dev<>prod diff (ensures both are cached, then delegates to the
// tested pure diffEnvVars).
export async function renderServiceEnvCompare(
  serviceIdA: string,
  serviceIdB: string,
): Promise<EnvDiffEntry[]> {
  const a =
    renderEnvCache.get(serviceIdA) ?? (await fetchRenderEnv(serviceIdA));
  const b =
    renderEnvCache.get(serviceIdB) ?? (await fetchRenderEnv(serviceIdB));
  return diffEnvVars(a, b);
}

// Trigger a new deploy of a service. Owner-initiated (the UI confirms first);
// the API key stays main-only.
export async function renderDeployService(serviceId: string): Promise<void> {
  const key = await getGlobalSecret(RENDER_KEY);
  if (!key) throw new Error("Render not connected");
  await renderTriggerDeploy(key, serviceId);
}

// Working-tree git status for a workspace.
export function gitStatusFor(root: string): Promise<GitStatus> {
  return gitStatus(root);
}

// Identity over guessing: surface ONLY an explicitly configured dev URL. The
// managed dev server (see main/devserver/manager) is the authoritative source
// for servers AirLock launched; we never probe guessed/common ports, which
// could attribute ANOTHER project's server (e.g. a shared :5173) to this one
// (the bug this fixes). hostStatus still probes the explicit URL for its dot.
export async function resolveDevUrl(root: string): Promise<string | null> {
  return (await readProjectConfig(root)).devUrl ?? null;
}

// Local dev server status: the resolved dev URL plus whether its host/port is
// reachable. up is null when there is no URL to probe.
export async function hostStatus(
  root: string,
): Promise<{ url: string | null; up: boolean | null }> {
  const url = await resolveDevUrl(root);
  if (!url) return { url: null, up: null };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { url, up: null };
  }
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  return { url, up: await probePort(u.hostname, port) };
}

// Vaulted postgres-url secrets projected for display PLUS a best-effort
// reachability probe. NEW composition for MCP. Each entry is the redacted
// parseConnString projection (host/database/user/redacted) -- NEVER the
// password or raw connection string -- plus reachable: did a short-lived ping
// succeed. The connection string (with password) is resolved MAIN-SIDE only and
// the probe wraps withDb in try/catch so neither the connstr nor any error can
// leak into the result; on any failure reachable is simply false.
export async function databaseStatus(root: string): Promise<
  {
    id: string;
    host: string;
    database: string;
    user: string;
    redacted: string;
    reachable: boolean;
  }[]
> {
  const metas = (await listSecrets(root)).filter(
    (m) => m.provider === "postgres-url",
  );
  const out = [];
  for (const m of metas) {
    const value = await getSecretValue(root, m.name);
    const info = value ? parseConnString(value) : null;
    // Best-effort reachability. The connection string lives only in this
    // local `value` and is passed straight to withDb; we capture ONLY the
    // boolean outcome. On any error reachable is false and nothing from the
    // error (which could echo the connstr) is retained.
    let reachable = false;
    if (value) {
      try {
        await withDb(value, (run) => pingDb(run));
        reachable = true;
      } catch {
        reachable = false;
      }
    }
    if (info) {
      out.push({
        id: m.name,
        host: info.host,
        database: info.database,
        user: info.user,
        redacted: info.redacted,
        reachable,
      });
    } else {
      // Unparseable -> a placeholder projection, NEVER the raw value.
      out.push({
        id: m.name,
        host: "",
        database: "(unparseable)",
        user: "",
        redacted: m.name,
        reachable,
      });
    }
  }
  return out; // NO password field, NO raw connection string
}

// Secret names with provider + validity. NEW composition for MCP. Projects the
// broker metadata to name/provider/valid; timestamps are dropped and NO secret
// values are read or returned.
export async function listSecretNames(
  root: string,
): Promise<{ name: string; provider: string | null; valid: boolean }[]> {
  const metas = await listSecrets(root);
  return metas.map((m) => ({
    name: m.name,
    provider: m.provider,
    valid: m.valid,
  }));
}

// --- Docker Postgres explorer -------------------------------------------
//
// The Docker section shows a container's DATABASES AND TABLES, the same depth
// Neon's section gives, rather than just a name and a stop button.
//
// THE CONNECTION URL NEVER LEAVES MAIN. It is built here from the container's
// own env (dockerPostgresUrl) and passed straight into withDb; the renderer
// receives only database names, table names and row values. This is the same
// rule the Neon API key and vaulted connection strings follow, and it is why
// the renderer addresses a database by CONTAINER ID rather than by URL.

// Resolve a container's Postgres URL, or null when one cannot be built (not a
// Postgres image, nothing published to the host, or no discoverable password).
async function containerPgUrl(id: string): Promise<string | null> {
  const all = await dockerContainers();
  const db = databaseContainers(all.containers).find((c) => c.id === id);
  if (db?.engine !== "postgres") return null;
  return dockerPostgresUrl(await dockerEnv(id), db.hostPort);
}

// The databases on a container's Postgres server. An empty array means "we
// could not connect"; the caller distinguishes that from "connected, none"
// using dockerPgReady below, so the UI can say WHICH.
export async function dockerPgDatabases(id: string): Promise<string[]> {
  const url = await containerPgUrl(id);
  if (!url) return [];
  return withDb(url, async (run) => {
    const res = await run.query(LIST_DATABASES_SQL);
    return res.rows.map((r) => String(r[0]));
  });
}

// Whether we have credentials for this container at all -- a value-free
// boolean, so the section can say "no credentials found" instead of rendering
// an empty list that looks like a working server with no databases.
export async function dockerPgReady(id: string): Promise<boolean> {
  return (await containerPgUrl(id)) !== null;
}

export async function dockerPgTables(
  id: string,
  database: string,
): Promise<DbTable[]> {
  const url = await containerPgUrl(id);
  if (!url) return [];
  return withDb(withDatabase(url, database), (run) => listTables(run));
}

export async function dockerPgRows(
  id: string,
  database: string,
  schema: string,
  table: string,
  limit: number,
): Promise<QueryResult> {
  const url = await containerPgUrl(id);
  if (!url) throw new Error("No credentials found for this container");
  return withDb(withDatabase(url, database), (run) =>
    readRows(run, schema, table, limit),
  );
}
