// packages/app/src/main/extensions/slackAvatars.ts
// Profile pictures for the Slack message view, as data URLs.
//
// Why main fetches these rather than the renderer pointing an <img> at
// avatars.slack-edge.com: the renderer's CSP is `img-src 'self' data:`, so a
// remote URL simply would not load -- and loosening it to admit a Slack CDN
// host would also be the renderer talking to Slack directly, which the rest of
// this feature deliberately never does. Fetching here keeps that rule and means
// avatars still render once cached with no network at all.
//
// Avatar URLs are public (no Authorization header), so the token is not used
// and never leaves the vault for this.
import type { SlackUser } from "@airlock/agent-core";

// A 72px avatar is a few KB; this bounds a pathological workspace.
const MAX_BYTES = 512 * 1024;
const TTL_MS = 60 * 60 * 1000;
// Enough for the members who actually appear in a sidebar's worth of history.
const MAX_ENTRIES = 200;

const cache = new Map<string, { at: number; dataUrl: string }>();

async function fetchOne(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/png";
    if (!type.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// id -> data URL, for the users that have an avatar. Users whose fetch fails
// are simply omitted: the sidebar already renders a colored initials circle,
// which is a fine fallback and better than a broken image.
export async function slackAvatarsFor(
  users: SlackUser[],
  now: number = Date.now(),
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const wanted: SlackUser[] = [];
  for (const u of users) {
    if (!u.avatar) continue;
    const hit = cache.get(u.avatar);
    if (hit && now - hit.at < TTL_MS) out[u.id] = hit.dataUrl;
    else wanted.push(u);
  }
  // Concurrently, but the whole point is that this happens once per hour per
  // workspace -- a member list is not a hot path.
  const got = await Promise.all(
    wanted.map(async (u) => [u, await fetchOne(u.avatar as string)] as const),
  );
  for (const [u, dataUrl] of got) {
    if (!dataUrl) continue;
    out[u.id] = dataUrl;
    cache.set(u.avatar as string, { at: now, dataUrl });
  }
  if (cache.size > MAX_ENTRIES) {
    // Oldest-first eviction; the map preserves insertion order.
    for (const k of [...cache.keys()].slice(0, cache.size - MAX_ENTRIES)) {
      cache.delete(k);
    }
  }
  return out;
}

export function forgetSlackAvatars(): void {
  cache.clear();
}
