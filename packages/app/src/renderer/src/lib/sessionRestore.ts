import type { SessionSnapshot } from "../../../shared/ipc";

export interface RestorePlan {
  roots: string[]; // existing project roots to reopen, in order
  resumeRoots: string[]; // subset of roots whose Claude chat should resume
  activeRoot: string | null; // which restored root to focus
  split: { a: string; b: string } | null; // both members guaranteed in roots
}

// Pure: turn a snapshot + an existence predicate into a concrete restore plan.
// Missing roots are dropped; the split survives only if BOTH members exist;
// active falls back to the first restored root when its saved root is gone.
export function planRestore(
  snap: SessionSnapshot,
  rootExists: (root: string) => boolean,
): RestorePlan {
  const roots = snap.tabs.map((t) => t.root).filter(rootExists);
  const set = new Set(roots);
  const resumeRoots = snap.tabs
    .filter((t) => t.hadClaude && set.has(t.root))
    .map((t) => t.root);
  const activeRoot =
    snap.activeRoot && set.has(snap.activeRoot)
      ? snap.activeRoot
      : (roots[0] ?? null);
  const split =
    snap.split && set.has(snap.split.a) && set.has(snap.split.b)
      ? snap.split
      : null;
  return { roots, resumeRoots, activeRoot, split };
}
