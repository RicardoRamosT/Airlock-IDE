// packages/agent-core/src/slack/parse.ts
// Pure parsers for the Slack Web API responses AirlLock consumes. Defensive:
// any non-ok / malformed payload degrades to a safe empty/not-ok value rather
// than throwing, so a transport hiccup never crashes a caller.

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// auth.test -> whether the token is valid + whose workspace/user it is.
export interface SlackAuth {
  ok: boolean;
  team?: string;
  user?: string;
  teamId?: string;
  userId?: string;
  error?: string;
}

export function parseAuthTest(json: unknown): SlackAuth {
  const r = obj(json);
  if (r.ok !== true) {
    return { ok: false, error: str(r.error) || "auth_failed" };
  }
  return {
    ok: true,
    team: str(r.team),
    user: str(r.user),
    teamId: str(r.team_id),
    userId: str(r.user_id),
  };
}

// conversations.list -> the conversations a token can see (archived skipped).
export type ConvKind = "public" | "private" | "im" | "mpim";
export interface SlackChannel {
  id: string;
  name: string;
  kind: ConvKind;
  userId?: string; // set only for im (the other party) -> used to build the label
}

// mpim is also is_private, so its check must precede the private check.
function convKind(c: Record<string, unknown>): ConvKind {
  if (c.is_im === true) return "im";
  if (c.is_mpim === true) return "mpim";
  if (c.is_private === true) return "private";
  return "public";
}

export function parseChannels(json: unknown): SlackChannel[] {
  const r = obj(json);
  if (r.ok !== true || !Array.isArray(r.channels)) return [];
  return r.channels
    .map((c) => obj(c))
    .filter((c) => c.is_archived !== true && typeof c.id === "string")
    .map((c) => {
      const kind = convKind(c);
      return kind === "im"
        ? { id: str(c.id), name: str(c.name), kind, userId: str(c.user) }
        : { id: str(c.id), name: str(c.name), kind };
    });
}

// users.list -> id -> display name (best available). Skips deleted accounts.
export interface SlackUser {
  id: string;
  name: string;
}

export function parseUsers(json: unknown): SlackUser[] {
  const r = obj(json);
  if (r.ok !== true || !Array.isArray(r.members)) return [];
  return r.members
    .map((m) => obj(m))
    .filter((m) => typeof m.id === "string" && m.deleted !== true)
    .map((m) => {
      const p = obj(m.profile);
      const name =
        str(p.display_name) ||
        str(m.real_name) ||
        str(p.real_name) ||
        str(m.name);
      return { id: str(m.id), name };
    });
}

// "mpdm-alice--bob--carol-1" -> "alice, bob, carol".
export function cleanMpimName(name: string): string {
  const m = name.match(/^mpdm-(.+?)-1$/);
  return (m?.[1] ?? name).split("--").filter(Boolean).join(", ");
}

// Turn raw conversations into display-labeled ones: im -> "<user> (DM)", mpim ->
// "<members> (group)", channels unchanged. Pure (network-free) so it is unit
// tested; slackAllChannels supplies the users map.
export function labelConversations(
  raw: SlackChannel[],
  users: SlackUser[],
): SlackChannel[] {
  const byId = new Map(users.map((u) => [u.id, u.name] as const));
  return raw.map((c) => {
    if (c.kind === "im") {
      const who = (c.userId && byId.get(c.userId)) || c.userId || "unknown";
      return { id: c.id, name: `${who} (DM)`, kind: c.kind };
    }
    if (c.kind === "mpim") {
      return {
        id: c.id,
        name: `${cleanMpimName(c.name)} (group)`,
        kind: c.kind,
      };
    }
    return { id: c.id, name: c.name, kind: c.kind };
  });
}

// conversations.history -> recent messages (newest-first from Slack).
export interface SlackMessage {
  ts: string;
  user: string;
  text: string;
}

export function parseHistory(json: unknown): SlackMessage[] {
  const r = obj(json);
  if (r.ok !== true || !Array.isArray(r.messages)) return [];
  return r.messages
    .map((m) => obj(m))
    .map((m) => ({ ts: str(m.ts), user: str(m.user), text: str(m.text) }));
}
