// packages/app/src/main/extensions/slackHistoryCache.ts
// A short-lived, MAIN-SIDE memory of each channel's last fetched history.
//
// Why it exists: proving a file belongs to an allow-listed channel costs a
// 100-message conversations.history round trip, and the sidebar has almost
// always just fetched exactly that history to render the chip the user clicked.
// Re-fetching it made every attachment click ~250ms slower for no new
// information.
//
// This does NOT weaken the gate. The cached history is data MAIN fetched from
// Slack itself -- never anything the renderer supplied -- so the proof is made
// against the same bytes it would otherwise re-request. The TTL is short, so a
// file posted since the last read still resolves through a live fetch.
import type { SlackHistory } from "@airlock/agent-core";

const TTL_MS = 60_000;

const cache = new Map<string, { at: number; history: SlackHistory }>();

const keyOf = (root: string, channelId: string) => `${root} ${channelId}`;

export function rememberHistory(
  root: string,
  channelId: string,
  history: SlackHistory,
  now: number = Date.now(),
): void {
  // Only successful reads are worth remembering: caching a refusal would make a
  // transient not_in_channel stick around for a minute.
  if (!history.ok) return;
  cache.set(keyOf(root, channelId), { at: now, history });
}

export function recentHistory(
  root: string,
  channelId: string,
  now: number = Date.now(),
): SlackHistory | null {
  const hit = cache.get(keyOf(root, channelId));
  if (!hit) return null;
  if (now - hit.at >= TTL_MS) {
    cache.delete(keyOf(root, channelId));
    return null;
  }
  return hit.history;
}

// Drop everything for a project (Slack reconnected, possibly to another
// workspace, where a remembered history would belong to the wrong team).
export function forgetHistories(root: string): void {
  for (const k of cache.keys()) if (k.startsWith(`${root} `)) cache.delete(k);
}
