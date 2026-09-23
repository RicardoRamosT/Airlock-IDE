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
  // Is this project in the DEBRIEF. Opt-in: false until the user says so.
  //
  // It lives on the project row, and every one of readRegistry, mergeRegistry
  // and writeRegistry must carry it, because refreshPortfolio rewrites the
  // whole table (DELETE + re-insert) on every arrival. A representation that
  // is not threaded through that cycle is erased seconds after being set.
  //
  // Off means OUT OF THE DEBRIEF, not forgotten: a disabled project is still
  // collected, still raises concerns, and can still be asked about in chat.
  enabled: boolean;
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
      // Deliberately NOT stamping lastSeenAt. Appearing in recents or in an
      // open tab is not evidence the folder is still on disk -- a recents
      // entry outlives the directory it names, which is the very case the
      // `missing` flag exists to report. Only applyPresenceResults writes
      // lastSeenAt, so the field means ONE thing: last confirmed present.
      continue;
    }
    const added: AtlasProject = {
      root,
      name: projectName(root),
      addedAt: now,
      lastSeenAt: now,
      missing: false,
      enabled: false, // opt-in
    };
    out.push(added);
    index.set(root, added);
  }
  return out;
}

/**
 * What a presence check found. THREE states, not two.
 *
 * "unknown" is the one that matters: a check can fail without proving
 * anything. `fs.access` throws ENOENT for a path that is gone, and EPERM for
 * one that exists behind a macOS permission prompt, and an I/O error for one
 * on a drive that is not mounted. Collapsing those into "not present" is how a
 * live project gets flagged as vanished -- and a flagged project is dropped
 * from the debrief, from the spine's dots and from the local-app monitor,
 * silently. Same rule as the spine's dotState: an unread probe is not a
 * negative answer.
 */
export type RootPresence = "present" | "gone" | "unknown";

/**
 * Record which roots still exist. A vanished root is FLAGGED, never dropped:
 * the author's own recents already contain a path that no longer exists, and
 * silently losing it would hide the fact rather than report it. Removing a row
 * is the USER's call, through forgetProject.
 *
 * Only evidence moves the flag. "unknown", and a root the probe said nothing
 * about, leave the entry exactly as it was -- both the flag and lastSeenAt,
 * since a failed read is not a sighting either.
 */
export function applyPresenceResults(
  projects: readonly AtlasProject[],
  results: ReadonlyMap<string, RootPresence>,
  now: number,
): AtlasProject[] {
  return projects.map((p) => {
    const found = results.get(p.root) ?? "unknown";
    if (found === "unknown") return { ...p };
    if (found === "gone") return { ...p, missing: true };
    return { ...p, missing: false, lastSeenAt: now };
  });
}

/**
 * The two-state form: every root NOT in `present` is taken to be gone.
 *
 * Only for callers that genuinely have that evidence for every root they pass.
 * Prefer applyPresenceResults, which can say "could not tell".
 */
export function applyPresence(
  projects: readonly AtlasProject[],
  present: ReadonlySet<string>,
  now: number,
): AtlasProject[] {
  return applyPresenceResults(
    projects,
    new Map(
      projects.map(
        (p) => [p.root, present.has(p.root) ? "present" : "gone"] as const,
      ),
    ),
    now,
  );
}
