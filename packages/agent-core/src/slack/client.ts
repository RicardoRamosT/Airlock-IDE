// packages/agent-core/src/slack/client.ts
// Thin Slack Web API client. The transport is injectable (DI) so the client is
// unit-testable without network; the real transport POSTs form-encoded to the
// Slack Web API using global fetch (Electron main / Node 18+). The bearer token
// is passed per call and NEVER logged.
import {
  parseAuthTest,
  parseChannels,
  parseHistory,
  parseUsers,
  type SlackAuth,
  type SlackChannel,
  type SlackHistory,
  type SlackUser,
} from "./parse";

export type SlackTransport = (
  method: string,
  token: string,
  params: Record<string, string>,
) => Promise<unknown>;

// Hard cap on any single Slack Web API call. Without it, a hung request (a
// stalled socket, an unreachable host) never rejects -- the tool call then
// blocks until the MCP client's own multi-minute timeout, which reads as "Slack
// just hangs". Abort at 15s so the caller gets a fast, catchable failure instead.
const SLACK_TIMEOUT_MS = 15_000;

export const fetchTransport: SlackTransport = async (method, token, params) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SLACK_TIMEOUT_MS);
  try {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body: new URLSearchParams(params).toString(),
      signal: ctrl.signal,
    });
    // await INSIDE the try so the timer covers body streaming too, and so a
    // timeout during .json() still rejects here rather than escaping.
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

export async function authTest(
  token: string,
  tx: SlackTransport = fetchTransport,
): Promise<SlackAuth> {
  return parseAuthTest(await tx("auth.test", token, {}));
}

// True only for a well-formed { ok: true } Slack response.
function slackOk(json: unknown): boolean {
  return (
    !!json && typeof json === "object" && (json as { ok?: unknown }).ok === true
  );
}

const ALL_TYPES = "public_channel,private_channel,mpim,im";
const SINGLE_TYPES = ["public_channel", "private_channel", "mpim", "im"];

export async function listChannels(
  token: string,
  includePrivate = true,
  tx: SlackTransport = fetchTransport,
): Promise<SlackChannel[]> {
  // One capped page (limit 1000) is plenty for a channel PICKER; pagination is
  // a follow-on.
  const page = (types: string) =>
    tx("conversations.list", token, {
      types,
      exclude_archived: "true",
      limit: "1000",
    });
  // Opted out (default project state): public channels only, one call.
  if (!includePrivate) return parseChannels(await page("public_channel"));
  // Opted in: prefer one call for all types. A partially-scoped token makes
  // Slack HARD-FAIL the whole combined request with missing_scope (ZERO
  // channels, not just zero of the missing type), so fall back to querying each
  // type independently and unioning what succeeds. Types are disjoint; a type
  // the token can't see yields [] via parseChannels (never a throw).
  const combined = await page(ALL_TYPES);
  if (slackOk(combined)) return parseChannels(combined);
  const perType = await Promise.all(SINGLE_TYPES.map((t) => page(t)));
  return perType.flatMap(parseChannels);
}

// Can this token actually READ private conversations?
//
// The scopes a token was granted are decided at AUTHORIZE time
// (extensions.slack.includePrivate -> slackScopes), and nothing records them
// afterwards -- the workspace pool stores only {id,name,domain}. So a project
// REUSING a pooled token cannot know from config whether private access is
// available: flipping includePrivate on a public-only token makes listChannels
// request every type, Slack hard-fails with missing_scope, and the per-type
// fallback quietly unions only the public result. The user ticks a box and
// nothing changes, with no explanation.
//
// Asking Slack is the only honest answer. One narrow call: if
// types=private_channel comes back ok, the token holds the private scopes.
//
// Returns false (never throws) on any failure -- a network error is not
// evidence of a scope, and the caller uses this to decide what to OFFER, where
// "assume not available" is the safe direction: it shows the upgrade path
// rather than a promise it cannot keep.
export async function canReadPrivate(
  token: string,
  tx: SlackTransport = fetchTransport,
): Promise<boolean> {
  try {
    return slackOk(
      await tx("conversations.list", token, {
        types: "private_channel",
        exclude_archived: "true",
        // 1, not 1000: this asks a yes/no question about scopes and has no use
        // for the payload.
        limit: "1",
      }),
    );
  } catch {
    return false;
  }
}

export async function listUsers(
  token: string,
  tx: SlackTransport = fetchTransport,
): Promise<SlackUser[]> {
  // One page (limit 1000) is plenty to label DMs for a picker; pagination is a
  // follow-on. users:read is granted whenever a project has opted in.
  return parseUsers(await tx("users.list", token, { limit: "1000" }));
}

export async function channelHistory(
  token: string,
  channel: string,
  limit: number,
  tx: SlackTransport = fetchTransport,
  // Slack's paging handle from the previous page. Omitted = the newest page.
  // This is what lets the sidebar walk PAST the 100-message per-request ceiling
  // instead of just asking for a bigger single window.
  cursor?: string,
): Promise<SlackHistory> {
  const params: Record<string, string> = {
    channel,
    limit: String(Math.max(1, Math.min(100, Math.floor(limit) || 20))),
  };
  if (cursor) params.cursor = cursor;
  return parseHistory(await tx("conversations.history", token, params));
}
