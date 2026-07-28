// packages/agent-core/src/integrations/summary.ts
// Pure aggregation for the Extension Hub: fold each integration manifest's
// detect status together with the user's per-integration prefs (enabled/pinned)
// into a UI-neutral ExtensionSummary. No I/O -- the app layer computes the
// DetectStatus map (engine.detectStatus) and reads prefs, then calls this.

import type { ExtensionAction } from "./actions";
import type { DetectStatus, RelevanceContext } from "./engine";
import { isRelevant, steadyView } from "./engine";
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
  // Why this extension is (or is not) live in the FOCUSED project:
  //   "signal"  - the project declares the manifest's own relevance signal
  //   "optedIn" - only the explicit per-project override applies
  //   "none"    - neither; its section shows the "isn't used here" state
  // Undefined when the question has no answer: no focused project, or a
  // manifest that declares no relevance spec (it can never be irrelevant).
  // The Hub's per-project toggle needs this to be HONEST -- checked/disabled
  // for "signal", where turning the override off would hide nothing.
  projectUse?: "signal" | "optedIn" | "none";
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
  // True iff this extension OWNS A RAIL AREA -- somewhere for "Open <name>" to
  // go. Set for section extensions (via mergeSectionExtensions) and for every
  // connected extension (via connectedSummary), which are the two kinds that
  // get a rail icon; manifest "status" rows get it only when they also have a
  // SECTION_EXTENSIONS entry.
  //
  // It first existed so the renderer could select rail icons by this flag
  // rather than by `tier === "section"`: an id with BOTH a manifest and a
  // SECTION_EXTENSIONS entry (Snowflake/Azure) surfaces as tier:"status"
  // post-merge and would otherwise lose its icon. It was then also read by
  // withOpenSection, as "owns an area" -- and the two readings diverged for
  // exactly the connected extensions, which is how the hub's Slack pane ended
  // up with no way to reach Slack's own sidebar area (fixed 2026-07-27).
  //
  // NOTE the rail composer takes connected and section extensions as SEPARATE
  // lists, so a connected row now satisfies both of its filters --
  // composeSectionMeta dedupes by id for that reason.
  hasSection?: boolean;
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
  // The focused project's relevance context, or null when no project is
  // focused. Only used to derive `projectUse`; everything else here is
  // account-wide.
  relevance: RelevanceContext | null = null,
): ExtensionSummary[] {
  return manifests.map((m) => {
    const enabled = isEnabled(prefs, m.id);
    const view = steadyView(m);
    const use = projectUseOf(m, relevance);
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
      ...(use ? { projectUse: use } : {}),
    };
  });
}

// Why an extension is (or is not) live in this project. Null for the two cases
// with no answer: no focused project, and a manifest with no relevance spec.
//
// SIGNAL IS CHECKED BEFORE THE OPT-IN, even though isRelevant checks them the
// other way round. isRelevant answers "is it on?", where the override
// short-circuits; this answers "what is keeping it on?", and with a signal
// present the override is not what is keeping it on -- removing it would
// change nothing. Reporting "optedIn" there would put a live switch in front
// of a decision the user cannot actually make.
function projectUseOf(
  m: IntegrationManifest,
  relevance: RelevanceContext | null,
): ExtensionSummary["projectUse"] | null {
  if (!m.relevance || !relevance) return null;
  if (isRelevant(m, { ...relevance, optedIn: [] })) return "signal";
  return relevance.optedIn.includes(m.id) ? "optedIn" : "none";
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
  statuses: Record<string, ExtensionSummary["status"]> = {},
): ExtensionSummary[] {
  return descriptors.map((d) => ({
    id: d.id,
    name: d.name,
    icon: d.icon,
    tier: "section" as const,
    category: d.contributesTo,
    // A REAL status, probed by the caller. This used to be a hardcoded "ready",
    // which forced every hub surface to special-case tier === "section" -- and
    // produced a bucket called "Has its own section", which says nothing a user
    // cares about (all of them have one). Each of these three already had a
    // probe in main: Docker's daemon, Neon's account, Render's API key. An
    // unprobed id reads "absent" rather than claiming a connection.
    status: statuses[d.id] ?? "absent",
    enabled: isEnabled(prefs, d.id),
    pinned: prefs[d.id]?.pinned === true,
    hasConfig: false,
    authKind: "token" as const,
  }));
}

// Fold section-extension rows into the Tier-1 manifest list, so an id present
// in BOTH (Snowflake and Azure are each a real IntegrationManifest in
// INTEGRATIONS *and* a SECTION_EXTENSIONS descriptor) produces exactly ONE hub
// row instead of two. Found 2026-07-27: `extensions:list` used to concatenate
// `buildExtensionSummaries(INTEGRATIONS, ...)` and
// `sectionExtensionSummaries(SECTION_EXTENSIONS, ...)` with no dedup, so the
// hub listed these services twice each -- once with a real detect status, once
// with a section row -- which makes the "complete inventory" this row exists
// for a WRONG one instead.
//
// The manifest row wins for an overlapping id: its status comes from the
// manifest's own detect command (CLI found / signed in), which is more
// specific than the section probe. It keeps its own `category` too (the
// section descriptor's is coarser). The ONE field it does NOT keep is `icon`:
// a Tier-1 manifest's icon is a generic codicon meant for the Activity feed,
// not the brand glyph SECTION_EXTENSIONS declares for the same id (SectionGlyph
// renders "snowflake" as an inline brand mark) -- so the rail icon would
// otherwise visibly regress to a codicon.
//
// Every row this returns that is EITHER an unmatched section-extension row OR
// the surviving manifest row for a matched one carries `hasSection: true`, so
// a renderer-side rail-icon selector can key off that flag instead of `tier
// === "section"` (which an overlapping id no longer has after this merge).
export function mergeSectionExtensions(
  tier1: ExtensionSummary[],
  sectionRows: ExtensionSummary[],
): ExtensionSummary[] {
  const sectionById = new Map(sectionRows.map((r) => [r.id, r]));
  const tier1Ids = new Set(tier1.map((r) => r.id));

  const mergedTier1 = tier1.map((r) => {
    const section = sectionById.get(r.id);
    if (!section) return { ...r, hasSection: false };
    return { ...r, icon: section.icon, hasSection: true };
  });

  const survivingSectionRows = sectionRows
    .filter((r) => !tier1Ids.has(r.id))
    .map((r) => ({ ...r, hasSection: true }));

  return [...mergedTier1, ...survivingSectionRows];
}
