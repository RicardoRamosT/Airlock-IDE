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
  type SlackMessage,
  type SlackUser,
} from "./parse";

export type SlackTransport = (
  method: string,
  token: string,
  params: Record<string, string>,
) => Promise<unknown>;

export const fetchTransport: SlackTransport = async (method, token, params) => {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: new URLSearchParams(params).toString(),
  });
  return res.json();
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
): Promise<SlackMessage[]> {
  const json = await tx("conversations.history", token, {
    channel,
    limit: String(Math.max(1, Math.min(100, Math.floor(limit) || 20))),
  });
  return parseHistory(json);
}
