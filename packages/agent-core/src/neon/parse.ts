import type { NeonBranch, NeonDatabase, NeonOrg, NeonProject } from "./client";

// Pure response parsers for the Neon REST API. These never touch fetch so they
// unit-test without network. Tolerant of missing/empty arrays and missing
// string fields (default to "") so a thin/unexpected payload never throws.
function arr(json: unknown, key: string): Record<string, unknown>[] {
  if (json && typeof json === "object") {
    const v = (json as Record<string, unknown>)[key];
    if (Array.isArray(v)) return v as Record<string, unknown>[];
  }
  return [];
}
const str = (o: Record<string, unknown>, k: string): string =>
  typeof o[k] === "string" ? (o[k] as string) : "";

// Tolerant of both a bare array and the wrapped { organizations: [...] } shape
// (the endpoint's exact envelope varies); either way pull id + name.
export function parseOrganizations(json: unknown): NeonOrg[] {
  const list = Array.isArray(json)
    ? (json as Record<string, unknown>[])
    : arr(json, "organizations");
  return list.map((o) => ({ id: str(o, "id"), name: str(o, "name") }));
}
export function parseProjects(json: unknown): NeonProject[] {
  return arr(json, "projects").map((p) => ({
    id: str(p, "id"),
    name: str(p, "name"),
  }));
}
export function parseBranches(json: unknown): NeonBranch[] {
  return arr(json, "branches").map((b) => ({
    id: str(b, "id"),
    name: str(b, "name"),
  }));
}
export function parseDatabases(json: unknown): NeonDatabase[] {
  return arr(json, "databases").map((d) => ({
    name: str(d, "name"),
    ownerName: str(d, "owner_name"),
  }));
}
export function parseConnectionUri(json: unknown): string {
  if (json && typeof json === "object") {
    const uri = (json as Record<string, unknown>).uri;
    if (typeof uri === "string" && uri) return uri;
  }
  throw new Error("Neon connection_uri missing");
}
