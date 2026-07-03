// packages/agent-core/src/integrations/connected.ts
// Tier-2 "connected extension" model: extensions that AirLock connects IN-APP
// (a token in the vault) and that carry stored config/permissions + agent tools
// -- unlike Tier-1 status manifests (a tool the user authed elsewhere). This
// file is the PURE half: the descriptor + declarative config schema + the Hub
// summary projection. The runtime half (connect/status/tools I/O) is a provider
// in app/main. Slack is the first connected extension.
import type { ExtensionSummary, ExtPrefs } from "./summary";

// One field in a connected extension's config/permission form, rendered
// generically by the Hub. Kept deliberately small:
//   - "text":   a single-line value.
//   - "toggle": a boolean.
//   - "channels": an allow-list of resources the user grants (Slack channels) --
//                 THE permission wall. Stored as an array of ids.
// `secret: true` marks a value that must be vaulted (never persisted to config).
export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "toggle" | "channels";
  help?: string;
  secret?: boolean;
}

export interface ConfigSchema {
  fields: ConfigField[];
}

// The pure, UI/IO-agnostic description of a connected extension. A matching
// provider (app/main) supplies the runtime (connect/status/resources/tools).
export interface ConnectedExtensionDescriptor {
  id: string;
  name: string;
  icon: string; // codicon name
  description: string;
  // A SECTION_META view id if the extension can be pinned into a category view;
  // omitted => Hub-only (Slack has no natural category).
  category?: string;
  configSchema: ConfigSchema;
}

// A connected extension's connection state (the runtime provider computes it):
// unauthed = no/invalid token; connected = token present + valid; error = probe
// failed. Projected onto ExtensionSummary["status"] (which also has "disabled").
export type ConnectedStatus = "unauthed" | "connected" | "error";

// Project a connected descriptor + its live status + prefs onto a Hub row.
// Mirrors buildExtensionSummaries' per-row rules: enabled:false => "disabled".
export function connectedSummary(
  d: ConnectedExtensionDescriptor,
  status: ConnectedStatus,
  prefs: ExtPrefs,
): ExtensionSummary {
  const enabled = prefs[d.id]?.enabled !== false;
  return {
    id: d.id,
    name: d.name,
    icon: d.icon,
    tier: "connected",
    category: d.category,
    status: enabled ? status : "disabled",
    enabled,
    pinned: prefs[d.id]?.pinned === true,
    hasConfig: d.configSchema.fields.length > 0,
  };
}

// Slack: the first connected extension. Claude reads context ONLY from channels
// the user allow-lists (the `channels` field = the permission wall). Hub-only
// (no category). The token is vaulted per-project by the provider.
export const SLACK_DESCRIPTOR: ConnectedExtensionDescriptor = {
  id: "slack",
  name: "Slack",
  icon: "comment-discussion",
  description:
    "Let Claude read context from Slack channels you explicitly allow.",
  configSchema: {
    fields: [
      {
        key: "channels",
        label: "Allowed channels",
        type: "channels",
        help: "Claude can read ONLY these channels. Nothing else is reachable.",
      },
    ],
  },
};

// Every shipped connected extension. Adding one = a descriptor here + a provider
// in app/main.
export const CONNECTED_EXTENSIONS: ConnectedExtensionDescriptor[] = [
  SLACK_DESCRIPTOR,
];
