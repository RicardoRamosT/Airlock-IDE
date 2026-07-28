// packages/app/src/main/extensions/slackTools.ts
// The Slack MCP tool logic, kept OUT of mcp/tools.ts because it reads the vaulted
// token (getSecretValue) -- a value-returning function the tools.ts source-guard
// forbids. mcp/tools.ts registers thin wrappers that call these via injected deps
// (wired in mcp/server.ts). THE PERMISSION WALL lives here: a channel is
// readable only if it is in the project's allow-list; the token is used to call
// Slack and never returned; only channel names + message text leave main.

import {
  type ConvKind,
  nameMessages,
  type SlackHistory,
  type SlackNamedMessage,
  type SlackUser,
  slackChannelHistory,
} from "@airlock/agent-core";
import { slackTokenFor } from "../slack/accounts";
import { type AllowedChannel, allowedChannels, convGlyph } from "./slack";
import { slackAvatarsFor } from "./slackAvatars";
import { rememberHistory } from "./slackHistoryCache";
import { slackUsersFor } from "./slackUsers";

// Resolve a user/agent-supplied channel token (id, "name", or "#name") to an
// allow-listed channel, or null if it is NOT allowed. Pure -> unit-tested; this
// is the gate. Matching by id OR name so the agent can use either.
export function resolveAllowedChannel(
  allowed: AllowedChannel[],
  channel: string,
): AllowedChannel | null {
  const q = channel.trim().replace(/^#/, "");
  return (
    allowed.find((c) => c.id === channel || c.id === q || c.name === q) ?? null
  );
}

export interface SlackReadResult {
  channel?: string;
  messages?: SlackNamedMessage[];
  error?: string;
  // Slack's handle for the page BEHIND this one. Absent at the oldest page.
  nextCursor?: string;
}

// Whether this project has a vaulted Slack token. Returns a BOOLEAN only -- the
// token never leaves this module. Lets the sidebar tell "not connected" apart
// from "connected but nothing allow-listed", which need different actions.
export async function slackConnected(root: string | null): Promise<boolean> {
  if (!root) return false;
  const token = await slackTokenFor(root);
  return !!token;
}

export async function slackListAllowedChannelsTool(
  root: string | null,
): Promise<{ channels: { id: string; name: string; kind: ConvKind }[] }> {
  if (!root) return { channels: [] };
  const allowed = await allowedChannels(root);
  return {
    channels: allowed.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
  };
}

// Impure dependencies, injected so the gate and the result mapping are unit
// testable without disk config or the keychain. Production passes nothing.
// Profile pictures for the users the sidebar is showing. Connection-gated like
// every other Slack read; returns id -> data URL (see slackAvatars.ts for why
// main does the fetching).
export async function slackAvatarsTool(
  root: string | null,
): Promise<Record<string, string>> {
  if (!root) return {};
  const token = await slackTokenFor(root);
  if (!token) return {};
  const users = await slackUsersFor(root, token);
  return slackAvatarsFor(users);
}

export interface SlackReadDeps {
  allowed?: (root: string) => Promise<AllowedChannel[]>;
  token?: (root: string) => Promise<string | null>;
  history?: (
    token: string,
    channel: string,
    limit: number,
    tx?: unknown,
    cursor?: string,
  ) => Promise<SlackHistory>;
  users?: (root: string, token: string) => Promise<SlackUser[]>;
  remember?: (root: string, channelId: string, history: SlackHistory) => void;
}

export async function slackReadChannelTool(
  root: string | null,
  channel: string,
  limit: number,
  deps: SlackReadDeps = {},
  // Slack's paging handle from the previous page; omitted = the newest page.
  // The gate above is unchanged -- a cursor cannot reach a channel the
  // allow-list does not already permit.
  cursor?: string,
): Promise<SlackReadResult> {
  if (!root) return { error: "No project is focused." };
  const getAllowed = deps.allowed ?? allowedChannels;
  const getToken = deps.token ?? ((r: string) => slackTokenFor(r));
  const getHistory = deps.history ?? slackChannelHistory;
  const getUsers = deps.users ?? slackUsersFor;
  const remember = deps.remember ?? rememberHistory;

  const allowed = await getAllowed(root);
  const match = resolveAllowedChannel(allowed, channel);
  if (!match) {
    const list =
      allowed.map((c) => `${convGlyph(c.kind)}${c.name}`).join(", ") ||
      "(none)";
    return {
      error: `Channel "${channel}" is not allowed. Allowed channels: ${list}.`,
    };
  }
  const token = await getToken(root);
  if (!token) return { error: "Slack is not connected for this project." };
  try {
    const history = await getHistory(token, match.id, limit, undefined, cursor);
    // Let an attachment click in this channel prove membership against THIS
    // fetch instead of paying for its own round trip a moment later.
    remember(root, match.id, history);
    if (!history.ok) {
      // Say WHY. An empty list here would claim the channel is empty when
      // Slack actually refused the read.
      return { error: `Slack refused: ${history.error}` };
    }
    const users = await getUsers(root, token);
    return {
      channel: `${convGlyph(match.kind)}${match.name}`,
      messages: nameMessages(history.messages, users),
      // Present only while older pages remain, so the UI can disable "Older"
      // at the true end of the conversation rather than guessing from a count.
      nextCursor: history.nextCursor,
    };
  } catch (e) {
    // Surface the reason (timeout/abort vs network) instead of a generic string
    // -- a bare "failed" hid why reads were stalling.
    return {
      error: `Slack request failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
