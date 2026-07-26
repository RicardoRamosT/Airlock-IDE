import type { Section, SectionVisibility } from "../../../shared/ipc";

export interface SectionMeta {
  id: Section;
  label: string;
  icon: string;
  kind: "builtin" | "extension";
}

// The BUILT-IN sidebar sections: canonical order, display label, activity-bar
// icon (codicon name). Extensions are appended at runtime by composeSectionMeta,
// so this list stays static and closed. The activity bar, the sidebar header,
// and the command palette all derive from the COMPOSED list (held in the store).
export const BUILTIN_SECTION_META: SectionMeta[] = [
  { id: "files", label: "Files", icon: "files", kind: "builtin" },
  { id: "secrets", label: "Secrets", icon: "lock", kind: "builtin" },
  { id: "git", label: "Git", icon: "source-control", kind: "builtin" },
  { id: "activity", label: "Activity", icon: "pulse", kind: "builtin" },
  { id: "databases", label: "Databases", icon: "database", kind: "builtin" },
  { id: "docker", label: "Docker", icon: "vm", kind: "builtin" },
  { id: "host", label: "Host", icon: "globe", kind: "builtin" },
  {
    id: "extensions",
    label: "Extensions",
    icon: "extensions",
    kind: "builtin",
  },
  { id: "audit", label: "Audit", icon: "shield", kind: "builtin" },
  { id: "events", label: "Events", icon: "list-flat", kind: "builtin" },
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

// Built-ins first, extensions after -- the order the rail renders, and what the
// divider between the two groups is derived from.
export function composeSectionMeta(
  exts: { id: string; name: string; icon?: string }[],
): SectionMeta[] {
  return [
    ...BUILTIN_SECTION_META,
    ...exts.map((e) => ({
      id: extSectionId(e.id) as Section,
      label: e.name,
      icon: e.icon ?? "extensions",
      kind: "extension" as const,
    })),
  ];
}

// The view the sidebar actually shows: the chosen view while visible, else the
// first visible section in rail order, else null (everything hidden). Pure
// read-time fallback -- hiding the active section via menu/MCP degrades
// gracefully without writing state. Takes the COMPOSED meta so an extension
// section that vanished (its extension disabled) also falls back, rather than
// leaving the sidebar pointed at a view that no longer exists.
export function effectiveView(
  active: Section,
  vis: SectionVisibility,
  meta: SectionMeta[],
): Section | null {
  const known = meta.some((m) => m.id === active);
  if (known && vis[active]) return active;
  return meta.find((m) => vis[m.id])?.id ?? null;
}
