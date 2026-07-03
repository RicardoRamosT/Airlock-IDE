// packages/app/src/main/extensions/github.ts
// The GitHub connected-extension provider -- the first OAuth (device-flow) one.
// Connect happens via the OAuth engine (extensions:oauthBegin), NOT a pasted key,
// so `connect` here just refuses a key path. Status is network-free (token
// presence in the vault, per-project), like Slack. The token is read main-only
// by github_read_issue; it never crosses IPC.
import {
  type ConnectedStatus,
  deleteSecret,
  type IntegrationItem,
  listSecrets,
} from "@airlock/agent-core";
import { oauthTokenName } from "./oauth/device";
import type { ConnectedProvider, ConnectResult } from "./provider";

const TOKEN = oauthTokenName("github");

export const githubProvider: ConnectedProvider = {
  id: "github",
  async connect(): Promise<ConnectResult> {
    return {
      ok: false,
      error: "GitHub connects by logging in (OAuth), not a pasted key.",
    };
  },
  async disconnect(root) {
    await deleteSecret(root, TOKEN).catch(() => {});
  },
  async status(root): Promise<ConnectedStatus> {
    const names = (await listSecrets(root).catch(() => [])).map((m) => m.name);
    return names.includes(TOKEN) ? "connected" : "unauthed";
  },
  async listResources(): Promise<IntegrationItem[]> {
    return [];
  },
};
