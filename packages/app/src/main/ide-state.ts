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
  type DockerStatus,
  dockerContainers,
  type GitStatus,
  getGlobalSecret,
  getSecretValue,
  gitStatus,
  headSha,
  listSecrets,
  type NeonBranch,
  type NeonDatabase,
  type NeonProject,
  neonListBranches,
  neonListDatabases,
  neonListProjects,
  normalizeRepoUrl,
  originRemoteUrl,
  parseConnString,
  pingDb,
  probePort,
  readProjectConfig,
  readWorkspaceFile,
  renderLatestDeploy,
  renderListServices,
  withDb,
} from "@airlock/agent-core";
import type { RenderServiceStatus, Section } from "../shared/ipc";
import { SECTION_LABELS } from "./menu";
import { loadPrefs, SECTIONS } from "./prefs";

const NEON_KEY = "NEON_API_KEY";
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

// Whether a Neon API key is connected. Returns only a boolean; the key itself
// never leaves main.
export async function neonStatus(): Promise<{ connected: boolean }> {
  return { connected: (await getGlobalSecret(NEON_KEY)) !== null };
}

// Neon projects (metadata only). The API key stays main-only.
export async function neonProjects(): Promise<NeonProject[]> {
  const key = await getGlobalSecret(NEON_KEY);
  if (!key) throw new Error("Neon not connected");
  return neonListProjects(key);
}

// Neon branches for a project (metadata only).
export async function neonBranches(p: string): Promise<NeonBranch[]> {
  const key = await getGlobalSecret(NEON_KEY);
  if (!key) throw new Error("Neon not connected");
  return neonListBranches(key, p);
}

// Neon databases for a project/branch (metadata only).
export async function neonDatabases(
  p: string,
  b: string,
): Promise<NeonDatabase[]> {
  const key = await getGlobalSecret(NEON_KEY);
  if (!key) throw new Error("Neon not connected");
  return neonListDatabases(key, p, b);
}

// Render services enriched with deploy state, filtered to this project's repo.
// App-global key stays main-only; returns an id/name/url/branch/deployStatus/
// deployed projection with NO key and NO secrets.
export async function renderServicesStatus(
  root: string | null,
): Promise<RenderServiceStatus[]> {
  const key = await getGlobalSecret(RENDER_KEY);
  if (!key) throw new Error("Render not connected");
  let services = await renderListServices(key);
  // Filter to THIS project's git repo when a workspace is open and its origin
  // remote matches a service repo. If nothing matches, fall back to all
  // services rather than hiding everything.
  if (root) {
    const origin = await originRemoteUrl(root);
    if (origin) {
      const want = normalizeRepoUrl(origin);
      const matched = services.filter((s) => normalizeRepoUrl(s.repo) === want);
      if (matched.length > 0) services = matched;
    }
  }
  // Local HEAD sha for the deployed-vs-HEAD comparison (best effort).
  let localSha = "";
  if (root) {
    try {
      localSha = await headSha(root);
    } catch {
      localSha = "";
    }
  }
  const out = [];
  for (const s of services) {
    let deployStatus = "";
    let deployed: boolean | null = null;
    try {
      const dep = await renderLatestDeploy(key, s.id);
      if (dep) {
        deployStatus = dep.status;
        // Compare with prefix tolerance: Render may report a short or full
        // commit sha vs the local full HEAD. null when either side is empty.
        deployed =
          localSha && dep.commit
            ? dep.commit === localSha ||
              dep.commit.startsWith(localSha) ||
              localSha.startsWith(dep.commit)
            : null;
      }
    } catch {
      deployStatus = "";
    }
    out.push({
      id: s.id,
      name: s.name,
      url: s.url,
      branch: s.branch,
      deployStatus,
      deployed,
    });
  }
  return out;
}

// Working-tree git status for a workspace.
export function gitStatusFor(root: string): Promise<GitStatus> {
  return gitStatus(root);
}

// Resolve the per-project dev URL: config.devUrl if set, else a best-effort
// guess from package.json (explicit --port flag, then framework default).
// Returns null when nothing can be determined. Shared by host:localUrl and
// hostStatus so the URL logic lives in one place.
export async function resolveDevUrl(root: string): Promise<string | null> {
  const cfg = await readProjectConfig(root);
  if (cfg.devUrl) return cfg.devUrl;
  try {
    const { content } = await readWorkspaceFile(root, "package.json");
    const pkg = JSON.parse(content) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    const scriptText = Object.values(pkg.scripts ?? {}).join(" ");
    const portMatch = scriptText.match(/--port[ =](\d{2,5})/);
    const port = portMatch
      ? Number(portMatch[1])
      : deps.next
        ? 3000
        : deps.vite || deps["@vitejs/plugin-react"]
          ? 5173
          : deps["react-scripts"]
            ? 3000
            : deps.astro
              ? 4321
              : null;
    return port ? `http://localhost:${port}` : null;
  } catch {
    return null;
  }
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
