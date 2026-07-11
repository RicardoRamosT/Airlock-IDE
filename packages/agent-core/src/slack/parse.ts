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
