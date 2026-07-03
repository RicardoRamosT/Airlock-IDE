// packages/app/src/main/extensions/slackTools.ts
// The Slack MCP tool logic, kept OUT of mcp/tools.ts because it reads the vaulted
// token (getSecretValue) -- a value-returning function the tools.ts source-guard
// forbids. mcp/tools.ts registers thin wrappers that call these via injected deps
// (wired in mcp/server.ts). THE PERMISSION WALL lives here: a channel is
// readable only if it is in the project's allow-list; the token is used to call
// Slack and never returned; only channel names + message text leave main.
import { getSecretValue, slackChannelHistory } from "@airlock/agent-core";
import {
  type AllowedChannel,
  allowedChannels,
  SLACK_TOKEN_NAME,
} from "./slack";

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
  messages?: { ts: string; user: string; text: string }[];
  error?: string;
}

export async function slackListAllowedChannelsTool(
  root: string | null,
): Promise<{ channels: { id: string; name: string }[] }> {
  if (!root) return { channels: [] };
  const allowed = await allowedChannels(root);
  return { channels: allowed.map((c) => ({ id: c.id, name: c.name })) };
}

export async function slackReadChannelTool(
  root: string | null,
  channel: string,
  limit: number,
): Promise<SlackReadResult> {
  if (!root) return { error: "No project is focused." };
  const allowed = await allowedChannels(root);
  const match = resolveAllowedChannel(allowed, channel);
  if (!match) {
    const list = allowed.map((c) => `#${c.name}`).join(", ") || "(none)";
    return {
      error: `Channel "${channel}" is not allowed. Allowed channels: ${list}.`,
    };
  }
  const token = await getSecretValue(root, SLACK_TOKEN_NAME).catch(() => null);
  if (!token) return { error: "Slack is not connected for this project." };
  try {
    const messages = await slackChannelHistory(token, match.id, limit);
    return { channel: `#${match.name}`, messages };
  } catch {
    return { error: "Slack request failed." };
  }
}
