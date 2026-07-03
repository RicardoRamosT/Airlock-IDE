// packages/agent-core/src/integrations/summary.ts
// Pure aggregation for the Extension Hub: fold each integration manifest's
// detect status together with the user's per-integration prefs (enabled/pinned)
// into a UI-neutral ExtensionSummary. No I/O -- the app layer computes the
// DetectStatus map (engine.detectStatus) and reads prefs, then calls this.

import type { DetectStatus } from "./engine";
import { steadyView } from "./engine";
import type { IntegrationManifest } from "./manifest";

// One row in the Extension Hub. Superset of DetectStatus so future Tier-2
// ("connected") extensions can report "connected"/"error"; "disabled" is
// derived here (enabled:false), never returned by the engine.
export interface ExtensionSummary {
  id: string;
  name: string;
  icon?: string; // codicon name; renderer falls back to a generic icon
  tier: "status" | "connected";
  // A SECTION_META view id (steady manifests, e.g. "host"); undefined when the
  // integration has no category view to pin into (activity-only, or Tier-2).
  category?: string;
  status: "absent" | "unauthed" | "ready" | "connected" | "error" | "disabled";
  enabled: boolean;
  pinned: boolean;
  hasConfig: boolean; // Tier-2 with a configSchema; always false for Tier-1
  // Passed through from the manifest so the Hub can offer an actionable button:
  // "Install <name>" on an absent row, "Connect <name>" on an unauthed row
  // (each runs its command in a new terminal -- user-initiated).
  install?: { command: string; docsUrl?: string };
  connect?: { command: string; docsUrl?: string };
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
): ExtensionSummary[] {
  return manifests.map((m) => {
    const enabled = isEnabled(prefs, m.id);
    const view = steadyView(m);
    return {
      id: m.id,
      name: m.name,
      icon: m.icon,
      tier: "status",
      category: view ?? undefined,
      status: enabled ? (statuses[m.id] ?? "absent") : "disabled",
      enabled,
      pinned: prefs[m.id]?.pinned === true,
      hasConfig: false,
      ...(m.install ? { install: m.install } : {}),
      ...(m.connect ? { connect: m.connect } : {}),
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
