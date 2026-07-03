// packages/app/src/main/extensions/provider.ts
// Runtime half of a Tier-2 connected extension (the pure descriptor lives in
// agent-core/integrations/connected.ts). A provider does the I/O the descriptor
// can't: connect (validate + vault a token), report connection status, list the
// resources the user granted, and (later) contribute permission-gated MCP tools.
// Everything is PER-PROJECT (root-scoped): the token is vaulted per project and
// the allow-list lives in that project's .airlock/config.json -- a tight,
// intentional permission wall, and it composes with the project-scoped MCP server.
import type { ConnectedStatus, IntegrationItem } from "@airlock/agent-core";
import { slackProvider } from "./slack";

export interface ConnectResult {
  ok: boolean;
  detail?: string; // e.g. the Slack workspace name on success
  error?: string; // a short reason on failure (never a secret)
}

export interface ConnectedProvider {
  id: string;
  // Validate `secret` (a pasted token) and, if valid, vault it for `root`.
  connect(root: string, secret: string): Promise<ConnectResult>;
  // Remove the vaulted credential for `root` (config/allow-list is left intact).
  disconnect(root: string): Promise<void>;
  // Cheap, NETWORK-FREE connection check for the Hub poll: is a token vaulted?
  status(root: string): Promise<ConnectedStatus>;
  // The granted resources (e.g. allow-listed channels) as Hub/section rows.
  listResources(root: string): Promise<IntegrationItem[]>;
}

// Every shipped connected provider, keyed by descriptor id.
export const CONNECTED_PROVIDERS: Record<string, ConnectedProvider> = {
  slack: slackProvider,
};
