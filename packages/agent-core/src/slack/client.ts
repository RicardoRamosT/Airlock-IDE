// packages/agent-core/src/slack/client.ts
// Thin Slack Web API client. The transport is injectable (DI) so the client is
// unit-testable without network; the real transport POSTs form-encoded to the
// Slack Web API using global fetch (Electron main / Node 18+). The bearer token
// is passed per call and NEVER logged.
import {
  parseAuthTest,
  parseChannels,
  parseHistory,
  type SlackAuth,
  type SlackChannel,
  type SlackMessage,
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

export async function listChannels(
  token: string,
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
  // Prefer public + private, but a user token with only channels:read (no
  // groups:read) makes Slack HARD-FAIL the whole combined request with
  // missing_scope -- returning ZERO channels, not just zero private ones. Fall
  // back to public-only so such a token still lists its public channels.
  // (Listing private channels needs groups:read, which requires re-consent and
  // the Slack app to declare it.)
  let json = await page("public_channel,private_channel");
  if (!slackOk(json)) json = await page("public_channel");
  return parseChannels(json);
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
