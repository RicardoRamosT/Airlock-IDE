// packages/app/src/main/extensions/slackUsers.ts
// Per-workspace user directory cache for display-name resolution. Thin wiring
// (network + a TTL map) -> untested per the repo convention; the pure mapping
// lives in agent-core/slack/names.ts. users:read is only granted to projects
// that opted into private access, so a failure here is NORMAL and degrades to
// raw ids rather than an error.
import { type SlackUser, slackListUsers } from "@airlock/agent-core";

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; users: SlackUser[] }>();

export async function slackUsersFor(
  root: string,
  token: string,
): Promise<SlackUser[]> {
  const hit = cache.get(root);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.users;
  const users = await slackListUsers(token).catch(() => [] as SlackUser[]);
  // Cache even an empty result: without users:read every call would otherwise
  // re-hit Slack on every poll tick.
  cache.set(root, { at: Date.now(), users });
  return users;
}

// Drop a project's cached directory (used when Slack reconnects to a different
// workspace, where every id would otherwise resolve against the old team).
export function forgetSlackUsers(root: string): void {
  cache.delete(root);
}
