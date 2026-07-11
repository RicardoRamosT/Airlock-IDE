// packages/app/src/main/extensions/slack.ts
// The Slack connected-extension provider. Connect = validate a pasted token
// (auth.test) then vault it per-project. Status = token presence (network-free,
// no keychain value prompt). Resources = the allow-listed channels. The token is
// read main-only and never crosses IPC; only channel names / (redacted) message
// text ever leave main.
import {
  type ConnectedStatus,
  type ConvKind,
  deleteSecret,
  getSecretValue,
  type IntegrationItem,
  labelConversations,
  listSecrets,
  readProjectConfig,
  type SlackChannel,
  setSecret,
  slackAuthTest,
  slackListChannels,
  slackListUsers,
} from "@airlock/agent-core";
import type { ConnectedProvider, ConnectResult } from "./provider";

// The vault secret name that holds a project's Slack token. MUST equal
// oauthTokenName("slack") = "SLACK_OAUTH_TOKEN" -- what the broker OAuth flow
// (ipc extensions:oauthBegin) vaults the token under. It was "SLACK_TOKEN" (the
// legacy paste-flow name), which never matched the OAuth-vaulted name, so status
// read empty and the row stayed "Available" despite a successful connect.
export const SLACK_TOKEN_NAME = "SLACK_OAUTH_TOKEN";

// One allow-listed conversation: {id} is what the API + gate use; {name} is the
// display label; {kind} drives the type glyph. Persisted in project config.
export interface AllowedChannel {
  id: string;
  name: string;
  kind: ConvKind;
}

// Coerce a persisted kind (or a legacy entry with none) to a ConvKind.
function asConvKind(v: unknown): ConvKind {
  return v === "private" || v === "im" || v === "mpim" ? v : "public";
}

// Read a project's Slack channel allow-list (the permission wall) from config.
// Defensive: any malformed entry is dropped. Exported so the MCP tools reuse the
// exact same gate as the UI.
export async function allowedChannels(root: string): Promise<AllowedChannel[]> {
  const cfg = await readProjectConfig(root);
  const raw = cfg.extensions?.slack?.channels;
  if (!Array.isArray(raw)) return [];
  const out: AllowedChannel[] = [];
  for (const c of raw) {
    if (c && typeof c === "object") {
      const o = c as { id?: unknown; name?: unknown; kind?: unknown };
      if (typeof o.id === "string") {
        out.push({
          id: o.id,
          name: typeof o.name === "string" ? o.name : o.id,
          kind: asConvKind(o.kind),
        });
      }
    }
  }
  return out;
}

// Whether this project has opted into private channels / DMs / group DMs.
export async function slackIncludePrivate(root: string): Promise<boolean> {
  const cfg = await readProjectConfig(root);
  return cfg.extensions?.slack?.includePrivate === true;
}

// All conversations the connected token can see (for the allow-list PICKER),
// with display labels. Needs the token (main-only) + network, so it is NOT on
// the cheap status path. users.list is fetched ONLY when a DM/group DM is
// present (to resolve names). Returns labels/ids/kinds only -- no messages, no
// token. [] when not connected.
export async function slackAllChannels(root: string): Promise<SlackChannel[]> {
  const token = await getSecretValue(root, SLACK_TOKEN_NAME).catch(() => null);
  if (!token) return [];
  const includePrivate = await slackIncludePrivate(root);
  const raw = await slackListChannels(token, includePrivate).catch(() => []);
  const needUsers =
    includePrivate && raw.some((c) => c.kind === "im" || c.kind === "mpim");
  const users = needUsers ? await slackListUsers(token).catch(() => []) : [];
  return labelConversations(raw, users);
}

export const slackProvider: ConnectedProvider = {
  id: "slack",

  async connect(root, secret): Promise<ConnectResult> {
    let ok = false;
    let team: string | undefined;
    let error: string | undefined;
    try {
      const auth = await slackAuthTest(secret);
      ok = auth.ok;
      team = auth.team;
      error = auth.error;
    } catch {
      return { ok: false, error: "network_error" };
    }
    if (!ok) return { ok: false, error: error ?? "auth_failed" };
    await setSecret(root, SLACK_TOKEN_NAME, secret); // vault it (main-only)
    return { ok: true, detail: team };
  },

  async disconnect(root) {
    await deleteSecret(root, SLACK_TOKEN_NAME).catch(() => {});
  },

  async status(root): Promise<ConnectedStatus> {
    // Network-free: presence of the vaulted token (names only -> no prompt).
    const names = (await listSecrets(root).catch(() => [])).map((m) => m.name);
    return names.includes(SLACK_TOKEN_NAME) ? "connected" : "unauthed";
  },

  async listResources(root): Promise<IntegrationItem[]> {
    const chans = await allowedChannels(root);
    return chans.map((c) => ({
      id: `int:slack:${c.id}`,
      title: `#${c.name}`,
      subtitle: "allowed",
      state: "idle" as const,
    }));
  },
};
