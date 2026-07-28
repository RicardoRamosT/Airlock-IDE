import type { Section, SectionVisibility } from "../../../shared/ipc";

export interface SectionMeta {
  id: Section;
  label: string;
  icon: string;
  // Which RAIL GROUP the icon belongs to, not where it came from: the built-in
  // Extensions hub sits in the "extensions" group (leading it), because that is
  // where a user looks for anything extension-related. Provenance is still
  // recoverable from the id via parseExtSection.
  group: "core" | "extensions";
}

// The built-in Extensions hub. Lives in the extensions rail group and leads it.
export const EXTENSIONS_HUB_SECTION = "extensions" as const;

// The BUILT-IN sidebar sections: canonical order, display label, activity-bar
// icon (codicon name). Extensions are appended at runtime by composeSectionMeta,
// so this list stays static and closed. The activity bar, the sidebar header,
// and the command palette all derive from the COMPOSED list (held in the store).
export const BUILTIN_SECTION_META: SectionMeta[] = [
  { id: "files", label: "Files", icon: "files", group: "core" },
  { id: "secrets", label: "Secrets", icon: "lock", group: "core" },
  { id: "git", label: "Git", icon: "source-control", group: "core" },
  { id: "activity", label: "Activity", icon: "pulse", group: "core" },
  { id: "databases", label: "Databases", icon: "database", group: "core" },
  { id: "host", label: "Host", icon: "globe", group: "core" },
  { id: "audit", label: "Audit", icon: "shield", group: "core" },
  { id: "events", label: "Events", icon: "list-flat", group: "core" },
  // LAST, and in the extensions group: the hub leads everything
  // extension-related, below the rail divider.
  {
    id: EXTENSIONS_HUB_SECTION,
    label: "Extensions",
    icon: "extensions",
    group: "extensions",
  },
];

const EXT_PREFIX = "ext:";

export function extSectionId(extId: string): string {
  return `${EXT_PREFIX}${extId}`;
}

// "ext:slack" -> "slack"; anything else (including a bare "ext:") -> null.
export function parseExtSection(section: string): string | null {
  if (!section.startsWith(EXT_PREFIX)) return null;
  const id = section.slice(EXT_PREFIX.length);
  return id.length > 0 ? id : null;
}

type ExtMeta = { id: string; name: string; icon?: string };

// Rail order below the divider: the hub leads (it is where you look for
// anything extension-related), then connected extensions, then section
// extensions, each alphabetical. Alphabetical rather than registry order so an
// icon sits in the same place in every project -- a rail that reshuffles
// destroys muscle memory.
export function composeSectionMeta(
  connected: ExtMeta[],
  sectionExts: ExtMeta[] = [],
): SectionMeta[] {
  const byName = (a: ExtMeta, b: ExtMeta) => a.name.localeCompare(b.name);
  const toMeta = (e: ExtMeta): SectionMeta => ({
    id: extSectionId(e.id) as Section,
    label: e.name,
    icon: e.icon ?? "extensions",
    group: "extensions" as const,
  });
  // Deduped by id, keeping the FIRST occurrence. The caller selects the two
  // lists with different filters (`tier === "connected"` and `hasSection`), and
  // a connected extension now satisfies BOTH -- it owns a rail area, which is
  // what lets the hub offer "Open <name>". Without this, Slack rendered twice.
  // Keeping the first occurrence means the connected list wins the position, so
  // a connected extension stays among the connected icons.
  const seen = new Set<string>();
  return [
    ...BUILTIN_SECTION_META,
    ...[...connected].sort(byName).map(toMeta),
    ...[...sectionExts].sort(byName).map(toMeta),
  ].filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

// The view the sidebar actually shows: the chosen view while visible, else the
// first visible section in rail order, else null (everything hidden). Pure
// read-time fallback -- hiding the active section via menu/MCP degrades
// gracefully without writing state. Takes the COMPOSED meta so an extension
// section that vanished (its extension disabled) also falls back, rather than
// leaving the sidebar pointed at a view that no longer exists.
// ABSENT means visible, matching main's listSidebarSections (`!== false`). A
// newly-appeared extension section has no persisted visibility key yet, so
// testing truthiness would hide every extension until the user toggled it.
export function isSectionVisible(vis: SectionVisibility, id: Section): boolean {
  return vis[id] !== false;
}

export function effectiveView(
  active: Section,
  vis: SectionVisibility,
  meta: SectionMeta[],
): Section | null {
  // The hub renders as a PAGE, not a sidebar body, so it can never be the
  // sidebar's view -- including when an older prefs file names it.
  const eligible = (id: Section) =>
    id !== EXTENSIONS_HUB_SECTION && isSectionVisible(vis, id);
  const known = meta.some((m) => m.id === active);
  if (known && eligible(active)) return active;
  return meta.find((m) => eligible(m.id))?.id ?? null;
}
