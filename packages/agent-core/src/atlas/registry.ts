// ASCII comments only. Pure registry logic. Atlas accumulates project roots and
// NEVER evicts them -- that is what separates a registry from AirLock's
// recentFolders, which is capped at RECENT_CAP = 10. A root that falls out of
// recents must not fall out of the portfolio.

export interface AtlasProject {
  root: string; // absolute path; the identity of a project
  name: string; // last path segment, for display
  addedAt: number; // epoch ms, first time Atlas saw this root
  lastSeenAt: number; // epoch ms, last time the root was confirmed present
  missing: boolean; // the path did not exist at the last presence check
}

// Last non-empty path segment. Trailing slashes are tolerated because roots
// arrive from several sources (prefs, tabs, user input) in inconsistent form.
export function projectName(root: string): string {
  const parts = root.split("/").filter((p) => p.length > 0);
  return parts.length > 0 ? (parts[parts.length - 1] as string) : root;
}

// Fold newly discovered roots into the registry. Additive only: unknown roots
// are appended, known roots have lastSeenAt refreshed, and nothing is removed.
export function mergeRegistry(
  existing: readonly AtlasProject[],
  discovered: readonly string[],
  now: number,
): AtlasProject[] {
  const out = existing.map((p) => ({ ...p }));
  const index = new Map(out.map((p) => [p.root, p] as const));
  for (const raw of discovered) {
    const root = raw.trim();
    if (root.length === 0) continue;
    const known = index.get(root);
    if (known) {
      known.lastSeenAt = now;
      continue;
    }
    const added: AtlasProject = {
      root,
      name: projectName(root),
      addedAt: now,
      lastSeenAt: now,
      missing: false,
    };
    out.push(added);
    index.set(root, added);
  }
  return out;
}

// Record which roots still exist on disk. A vanished root is FLAGGED, never
// dropped: the author's own recents already contain a path that no longer
// exists, and silently losing it would hide the fact rather than report it.
export function applyPresence(
  projects: readonly AtlasProject[],
  present: ReadonlySet<string>,
  now: number,
): AtlasProject[] {
  return projects.map((p) => {
    const here = present.has(p.root);
    return { ...p, missing: !here, lastSeenAt: here ? now : p.lastSeenAt };
  });
}
