import type { RenderDeploy, RenderService } from "./client";

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

export function parseServices(json: unknown): RenderService[] {
  return items(json).map((it) => {
    const s = unwrap(it, "service");
    const details =
      s.serviceDetails && typeof s.serviceDetails === "object"
        ? (s.serviceDetails as Record<string, unknown>)
        : undefined;
    return {
      id: str(s, "id"),
      name: str(s, "name"),
      repo: str(s, "repo"),
      branch: str(s, "branch"),
      url: str(details, "url"),
    };
  });
}
export function parseLatestDeploy(json: unknown): RenderDeploy | null {
  const first = items(json)[0];
  if (!first) return null;
  const d = unwrap(first, "deploy");
  const commit =
    d.commit && typeof d.commit === "object"
      ? str(d.commit as Record<string, unknown>, "id")
      : "";
  return { status: str(d, "status"), commit };
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
