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

import {
  COMMON_DEV_PORTS,
  type DockerStatus,
  diffEnvVars,
  dockerContainers,
  type EnvDiffEntry,
  excludeReservedPorts,
  FRONTEND_SUBDIRS,
  type GitStatus,
  getGlobalSecret,
  getSecretValue,
  gitStatus,
  guessDevPort,
  headSha,
  listSecrets,
  type NeonBranch,
  type NeonDatabase,
  type NeonOrg,
  type NeonProject,
  neonListBranches,
  neonListDatabases,
  neonListOrganizations,
  neonListProjects,
  originRemoteUrl,
  type PortProber,
  parseConnString,
  pickListeningPort,
  pingDb,
  probePort,
  type RenderDeploy,
  type RenderEnvVar,
  readProjectConfig,
  readWorkspaceFile,
  renderLatestDeploy,
  renderListDeploys,
  renderListEnvVars,
  renderListServices,
  renderTriggerDeploy,
  servicesForRepo,
  withDb,
} from "@airlock/agent-core";
import type { RenderServiceStatus, Section } from "../shared/ipc";
import { SECTION_LABELS } from "./menu";
import { keyForProject } from "./neon/accounts";
import { loadPrefs, SECTIONS } from "./prefs";

const RENDER_KEY = "RENDER_API_KEY";

// Sidebar sections with their app-global visibility, projected for display.
// Reads the persisted visibility map and maps it over the canonical section
// order with human labels. App-global (no root needed).
export async function listSidebarSections(
  prefsFile: string,
): Promise<{ id: Section; label: string; visible: boolean }[]> {
  const prefs = await loadPrefs(prefsFile);
  return SECTIONS.map((id) => ({
    id,
    label: SECTION_LABELS[id],
    visible: prefs.sectionVisibility[id] !== false,
  }));
}

// Docker engine + container status. Machine-global (no root needed).
export function dockerStatus(): Promise<DockerStatus> {
  return dockerContainers();
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

// Resolve the per-project dev URL. config.devUrl wins (explicit; shown whether
// or not it is reachable). Otherwise DETECT a running server: guess candidate
// ports from package.json at the root AND common frontend subdirs (frontend/,
// web/, ...), then surface a port that is actually LISTENING -- preferring a
// guessed one, else scanning the common dev ports. Returns null when nothing is
// up, so a guessed-but-down port is never shown (the old root-only guess gave
// both false negatives -- a frontend in a subdir -- and false positives -- a
// guessed port occupied by an unrelated server). Shared by host:localUrl and
// hostStatus. The prober is injectable; defaults to the real TCP probe.
export async function resolveDevUrl(
  root: string,
  probe: PortProber = probePort,
): Promise<string | null> {
  const cfg = await readProjectConfig(root);
  if (cfg.devUrl) return cfg.devUrl;
  const guessed: number[] = [];
  for (const sub of FRONTEND_SUBDIRS) {
    const rel = sub ? `${sub}/package.json` : "package.json";
    try {
      const { content } = await readWorkspaceFile(root, rel);
      const port = guessDevPort(content);
      if (port && !guessed.includes(port)) guessed.push(port);
    } catch {
      // no package.json at this path -- skip
    }
  }
  // Never auto-surface an OS-reserved port: macOS runs the AirPlay Receiver /
  // Control Center on 5000/7000, so a TCP connect there succeeds with no dev
  // server -- which would show the OS as a phantom "host up" (the reported
  // http://localhost:5000 false positive). Filter both guessed and common
  // candidates; an explicit cfg.devUrl above bypasses detection entirely.
  const port = await pickListeningPort(
    excludeReservedPorts(guessed, process.platform),
    probe,
    excludeReservedPorts(COMMON_DEV_PORTS, process.platform),
  );
  return port ? `http://localhost:${port}` : null;
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
