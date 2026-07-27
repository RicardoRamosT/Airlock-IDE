// packages/agent-core/src/integrations/summary.ts
// Pure aggregation for the Extension Hub: fold each integration manifest's
// detect status together with the user's per-integration prefs (enabled/pinned)
// into a UI-neutral ExtensionSummary. No I/O -- the app layer computes the
// DetectStatus map (engine.detectStatus) and reads prefs, then calls this.

import type { ExtensionAction } from "./actions";
import type { DetectStatus } from "./engine";
import { steadyView } from "./engine";
import type { IntegrationManifest } from "./manifest";
import type { SectionExtensionDescriptor } from "./sectionExtensions";

// One row in the Extension Hub. Superset of DetectStatus so future Tier-2
// ("connected") extensions can report "connected"/"error"; "disabled" is
// derived here (enabled:false), never returned by the engine.
export interface ExtensionSummary {
  id: string;
  name: string;
  icon?: string; // codicon name; renderer falls back to a generic icon
  // "section": a hub row for a SECTION_EXTENSIONS descriptor -- a service that
  // owns a rail section (Docker, Neon, ...) rather than a polled manifest or an
  // OAuth "connected" extension. See sectionExtensionSummaries below.
  tier: "status" | "connected" | "section";
  // The sidebar section the eye surfaces this into: a SECTION_META view id
  // ("host"/"databases" for steady manifests, "activity" for transient ones);
  // undefined only when there is no target section (a Tier-2 Hub-only ext).
  category?: string;
  status: "absent" | "unauthed" | "ready" | "connected" | "error" | "disabled";
  enabled: boolean;
  pinned: boolean;
  hasConfig: boolean; // Tier-2 with a configSchema; always false for Tier-1
  // How the extension authenticates: "token" (paste) or "oauth2" (browser login).
  // Drives which Connect flow the Hub opens for a Tier-2 row.
  authKind: "token" | "oauth2";
  // For a connected Tier-2 row: a short account/workspace label shown next to the
  // name (e.g. the Slack workspace). Populated main-side from per-project config.
  account?: string;
  // Passed through from the manifest so the Hub can offer an actionable button:
  // "Install <name>" on an absent row, "Connect <name>" on an unauthed row
  // (each runs its command in a new terminal -- user-initiated).
  install?: { command: string; docsUrl?: string };
  connect?: { command: string; docsUrl?: string };
  // The actions this row offers, computed by extensionActions and attached
  // main-side. The renderer cannot value-import agent-core, so shipping the
  // decision with the data keeps one source of truth instead of a second
  // implementation in the UI.
  actions?: ExtensionAction[];
}

// Per-integration prefs, keyed by manifest/extension id. Both fields optional so
// an absent entry means "default": enabled, not pinned.
export type ExtPrefs = Record<string, { enabled?: boolean; pinned?: boolean }>;

function isEnabled(prefs: ExtPrefs, id: string): boolean {
  return prefs[id]?.enabled !== false; // default enabled
}

// Merge manifests + detect statuses + prefs into Hub rows. `statuses` is keyed
// by manifest id; a missing entry reads as "absent" (not yet probed / no CLI).
export function buildExtensionSummaries(
  manifests: IntegrationManifest[],
  statuses: Record<string, DetectStatus>,
  prefs: ExtPrefs,
  accounts: Record<string, string | undefined> = {},
): ExtensionSummary[] {
  return manifests.map((m) => {
    const enabled = isEnabled(prefs, m.id);
    const view = steadyView(m);
    // Activity-surface manifests have no steady view; treat "activity" as their
    // category so the eye toggle can surface them into the Activity feed.
    const category =
      m.surface === "activity" ? "activity" : (view ?? undefined);
    return {
      id: m.id,
      name: m.name,
      icon: m.icon,
      tier: "status",
      category,
      status: enabled ? (statuses[m.id] ?? "absent") : "disabled",
      enabled,
      pinned: prefs[m.id]?.pinned === true,
      hasConfig: false,
      authKind: "token",
      ...(m.install ? { install: m.install } : {}),
      ...(m.connect ? { connect: m.connect } : {}),
      ...(accounts[m.id] ? { account: accounts[m.id] } : {}),
    };
  });
}

// Manifests the user has NOT disabled. Used to gate steady/activity polling so a
// disabled integration stops being probed and surfaced.
export function enabledManifests(
  manifests: IntegrationManifest[],
  prefs: ExtPrefs,
): IntegrationManifest[] {
  return manifests.filter((m) => isEnabled(prefs, m.id));
}

// Manifests the user has pinned into their category view AND not disabled. Used
// by the steady surface: category views (Host/Databases) show an integration
// only when it is pinned (default: Hub-only, clean sidebar).
export function pinnedEnabledManifests(
  manifests: IntegrationManifest[],
  prefs: ExtPrefs,
): IntegrationManifest[] {
  return manifests.filter(
    (m) => prefs[m.id]?.pinned === true && isEnabled(prefs, m.id),
  );
}

// Hub rows for the section extensions. `status: "ready"` here is a PLACEHOLDER,
// not a claim of connectedness -- their real liveness is owned by their own
// sections (Docker's CLI probe, Neon's accounts), which this registry
// deliberately knows nothing about, so it cannot report anything truer than
// this. NOT inventing a real status is deliberate too: a new status union
// member would ripple through every exhaustive switch that already handles
// "absent" | "unauthed" | "ready" | "connected" | "error" | "disabled". The
// burden this placeholder creates falls on any PRESENTATION of these rows: it
// must branch on `tier === "section"` and never read this "ready" as
// "installed and signed in" (see ExtensionsTab's groupOf/statusDot/statusLine/
// noActionsNote, fixed 2026-07-27 after the hub was found painting all six
// section extensions green with no Install button, disconnected or not). The
// row exists so the hub is a COMPLETE inventory; it was missing Neon and
// Docker entirely.
export function sectionExtensionSummaries(
  descriptors: SectionExtensionDescriptor[],
  prefs: ExtPrefs,
): ExtensionSummary[] {
  return descriptors.map((d) => ({
    id: d.id,
    name: d.name,
    icon: d.icon,
    tier: "section" as const,
    category: d.contributesTo,
    status: "ready" as const,
    enabled: isEnabled(prefs, d.id),
    pinned: prefs[d.id]?.pinned === true,
    hasConfig: false,
    authKind: "token" as const,
  }));
}
