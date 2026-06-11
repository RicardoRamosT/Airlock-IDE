// Pure parse of GitHub's releases/latest payload into the fields we need.
export interface LatestRelease {
  tag: string;
  version: string; // tag without a leading v
  htmlUrl: string;
  dmgUrl: string | null; // the -arm64.dmg asset, else any .dmg, else null
}

export function parseLatestRelease(json: unknown): LatestRelease | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const tag = typeof o.tag_name === "string" ? o.tag_name : null;
  const htmlUrl = typeof o.html_url === "string" ? o.html_url : null;
  if (!tag || !htmlUrl) return null;
  const assets = Array.isArray(o.assets) ? o.assets : [];
  const urls = assets
    .map((a) =>
      a && typeof a === "object" ? (a as Record<string, unknown>) : null,
    )
    .filter((a): a is Record<string, unknown> => a !== null)
    .map((a) => ({
      name: typeof a.name === "string" ? a.name : "",
      url:
        typeof a.browser_download_url === "string" ? a.browser_download_url : "",
    }))
    .filter((a) => a.url !== "");
  const dmgUrl =
    urls.find((a) => a.name.endsWith("-arm64.dmg"))?.url ??
    urls.find((a) => a.name.endsWith(".dmg"))?.url ??
    null;
  return { tag, version: tag.replace(/^v/, ""), htmlUrl, dmgUrl };
}
