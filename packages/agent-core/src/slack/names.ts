// packages/agent-core/src/slack/names.ts
// Pure display-name resolution for Slack messages. Lives in the SHARED read
// path so the agent and the sidebar see the same names -- resolving only in the
// renderer would leave the agent staring at raw "U0BF0KLPNP3" ids.
import { renderEmoji } from "./emoji";
import type { SlackFile, SlackMessage, SlackUser } from "./parse";

export interface SlackNamedMessage {
  ts: string;
  user: string;
  userName: string;
  text: string;
  files: SlackFile[];
}

// Slack writes mentions as <@U123> or <@U123|label>. An id we cannot resolve is
// left EXACTLY as-is: a half-rewritten mention is worse than the raw token.
const MENTION = /<@([UW][A-Z0-9]+)(\|[^>]*)?>/g;

export function resolveMentions(text: string, users: SlackUser[]): string {
  if (!text.includes("<@")) return text;
  const byId = new Map(users.map((u) => [u.id, u.name] as const));
  return text.replace(MENTION, (whole, id: string) => {
    const name = byId.get(id);
    return name ? `@${name}` : whole;
  });
}

export function nameMessages(
  messages: SlackMessage[],
  users: SlackUser[],
): SlackNamedMessage[] {
  const byId = new Map(users.map((u) => [u.id, u.name] as const));
  return messages.map((m) => ({
    ts: m.ts,
    user: m.user,
    userName: (m.user && (byId.get(m.user) ?? m.user)) || "unknown",
    // Emoji AFTER mentions: both operate on :colon: / <@…> forms that do not
    // overlap, and the agent should see 🙂 rather than a shortcode too.
    text: renderEmoji(resolveMentions(m.text, users)),
    files: m.files,
  }));
}
