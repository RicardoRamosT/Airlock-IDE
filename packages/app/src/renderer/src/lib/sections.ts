import type { Section, SectionVisibility } from "../../../shared/ipc";

// Single source of truth for the sidebar sections: canonical order, display
// label, and activity-bar icon (codicon name). The activity bar, the sidebar
// header, and the command palette all derive from this list.
export const SECTION_META: { id: Section; label: string; icon: string }[] = [
  { id: "files", label: "Files", icon: "files" },
  { id: "secrets", label: "Secrets", icon: "lock" },
  { id: "git", label: "Git", icon: "source-control" },
  { id: "activity", label: "Activity", icon: "pulse" },
  { id: "databases", label: "Databases", icon: "database" },
  { id: "docker", label: "Docker", icon: "vm" },
  { id: "host", label: "Host", icon: "globe" },
  { id: "audit", label: "Audit", icon: "shield" },
];

// The view the sidebar actually shows: the chosen view while visible, else the
// first visible section in rail order, else null (everything hidden). Pure
// read-time fallback -- hiding the active section via menu/MCP degrades
// gracefully without writing state.
export function effectiveView(
  active: Section,
  vis: SectionVisibility,
): Section | null {
  if (vis[active]) return active;
  return SECTION_META.find((m) => vis[m.id])?.id ?? null;
}
