import type { RenderDeploy, RenderEnvVar, RenderService } from "./client";

// Pure response parsers for the Render REST API. These never touch fetch so
// they unit-test without network. Render list endpoints return an envelope
// ([{service:{...}}], [{deploy:{...}}]); unwrap unwraps it but tolerates a
// bare item. Missing string fields default to "" so a thin payload never
// throws.
function items(json: unknown): Record<string, unknown>[] {
  return Array.isArray(json) ? (json as Record<string, unknown>[]) : [];
}
const str = (o: Record<string, unknown> | undefined, k: string): string =>
  o && typeof o[k] === "string" ? (o[k] as string) : "";
function unwrap(
  item: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const inner = item[key];
  return inner && typeof inner === "object"
    ? (inner as Record<string, unknown>)
    : item;
}

const obj = (
  o: Record<string, unknown> | undefined,
  k: string,
): Record<string, unknown> | undefined =>
  o && o[k] && typeof o[k] === "object"
    ? (o[k] as Record<string, unknown>)
    : undefined;

// Render reports autoDeploy as "yes"/"no" (older payloads) or a boolean.
function parseAutoDeploy(v: unknown): boolean | null {
  if (v === "yes" || v === true) return true;
  if (v === "no" || v === false) return false;
  return null;
}

const firstLine = (s: string): string => s.split("\n", 1)[0] ?? "";

export function parseServices(json: unknown): RenderService[] {
  return items(json).map((it) => {
    const s = unwrap(it, "service");
    const details = obj(s, "serviceDetails");
    return {
      id: str(s, "id"),
      name: str(s, "name"),
      repo: str(s, "repo"),
      branch: str(s, "branch"),
      url: str(details, "url"),
      type: str(s, "type"),
      region: str(details, "region"),
      plan: str(details, "plan"),
      autoDeploy: parseAutoDeploy(s.autoDeploy),
      dashboardUrl: str(s, "dashboardUrl"),
    };
  });
}

function parseDeploy(item: Record<string, unknown>): RenderDeploy {
  const d = unwrap(item, "deploy");
  const commit = obj(d, "commit");
  return {
    id: str(d, "id"),
    status: str(d, "status"),
    commit: str(commit, "id"),
    message: firstLine(str(commit, "message")),
    // Prefer the finish time; fall back to creation for an in-progress deploy.
    at: str(d, "finishedAt") || str(d, "createdAt"),
    trigger: str(d, "trigger"),
  };
}

export function parseDeploys(json: unknown): RenderDeploy[] {
  return items(json).map(parseDeploy);
}

export function parseLatestDeploy(json: unknown): RenderDeploy | null {
  return items(json).map(parseDeploy)[0] ?? null;
}
export function normalizeRepoUrl(url: string): string {
  if (!url) return "";
  let s = url.trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^git@/, "");
  s = s
    .replace(/:/g, "/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  return s;
}

// Scope a list of services to the ones deployed from `originUrl` (the project's
// git origin remote). A Render service always has a source repo, so an empty
// origin or no match means this project simply isn't deployed on Render -> []
// (show nothing), NOT every service in the account leaking into an unrelated
// project. Matching is normalized (https/ssh/.git/case all compare equal).
export function servicesForRepo<T extends { repo: string }>(
  services: T[],
  originUrl: string | null,
): T[] {
  const want = originUrl ? normalizeRepoUrl(originUrl) : "";
  if (!want) return [];
  return services.filter((s) => normalizeRepoUrl(s.repo) === want);
}

// Render's GET /v1/services/{id}/env-vars returns items that wrap the var in an
// `envVar` object: [{ envVar: { key, value }, cursor }]. Defensive like
// parseServices; skip items without a string key.
export function parseEnvVars(json: unknown): RenderEnvVar[] {
  return items(json)
    .map((it) => {
      const e = unwrap(it, "envVar");
      return { key: str(e, "key"), value: str(e, "value") };
    })
    .filter((v) => v.key !== "");
}

export interface EnvDiffEntry {
  key: string;
  inA: boolean; // present in service A (dev)
  inB: boolean; // present in service B (prod)
  status: "equal" | "differs" | "only-a" | "only-b";
}

// Value-free comparison: compares values internally but the returned entries
// carry only presence + an equal/differs verdict, never the values themselves.
export function diffEnvVars(
  a: RenderEnvVar[],
  b: RenderEnvVar[],
): EnvDiffEntry[] {
  const mapA = new Map(a.map((v) => [v.key, v.value]));
  const mapB = new Map(b.map((v) => [v.key, v.value]));
  const keys = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort();
  return keys.map((key) => {
    const inA = mapA.has(key);
    const inB = mapB.has(key);
    let status: EnvDiffEntry["status"];
    if (inA && inB) {
      status = mapA.get(key) === mapB.get(key) ? "equal" : "differs";
    } else if (inA) {
      status = "only-a";
    } else {
      status = "only-b";
    }
    return { key, inA, inB, status };
  });
}
