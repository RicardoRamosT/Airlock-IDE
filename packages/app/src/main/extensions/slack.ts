// packages/app/src/main/extensions/slack.ts
// The Slack connected-extension provider. Connect = validate a pasted token
// (auth.test) then vault it per-project. Status = token presence (network-free,
// no keychain value prompt). Resources = the allow-listed channels. The token is
// read main-only and never crosses IPC; only channel names / (redacted) message
// text ever leave main.
import {
  type ConnectedStatus,
  deleteSecret,
  type IntegrationItem,
  listSecrets,
  readProjectConfig,
  setSecret,
  slackAuthTest,
} from "@airlock/agent-core";
import type { ConnectedProvider, ConnectResult } from "./provider";

// The vault secret name that holds a project's Slack token.
export const SLACK_TOKEN_NAME = "SLACK_TOKEN";

// One allow-listed channel: {id} is what the API + gate use; {name} is for
// display (so the Hub/tools can show #name without a network round-trip).
export interface AllowedChannel {
  id: string;
  name: string;
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
      const o = c as { id?: unknown; name?: unknown };
      if (typeof o.id === "string") {
        out.push({
          id: o.id,
          name: typeof o.name === "string" ? o.name : o.id,
        });
      }
    }
  }
  return out;
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
