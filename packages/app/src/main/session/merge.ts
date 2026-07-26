// packages/app/src/main/session/merge.ts
// Merge the per-window layout snapshots into the ONE session.json we persist.
//
// Each renderer reports only its OWN tabs, and the store used to keep just the
// last report -- so with two windows open the last one to save clobbered the
// other's tabs and they were gone after a restart. Tab tear-off makes two windows
// routine, so the snapshot is now the UNION of the live windows.
//
// Restore still rebuilds a single window (SessionSnapshot has no window grouping),
// so a torn-off tab comes back alongside the others rather than in its own window.
// That is the documented trade-off -- losing the tabs entirely is not.
//
// ASCII-only comments (CJS-bundled into Electron main).
import type { SessionSnapshot } from "../../shared/ipc";

export interface WindowSnapshot {
  id: number;
  snap: SessionSnapshot;
}

export function mergeSnapshots(
  entries: readonly WindowSnapshot[],
  focusedId: number | null,
): SessionSnapshot | null {
  if (entries.length === 0) return null;
  // The focused window leads: its tabs come first in the restored strip order and
  // its activeRoot/split win, so restore favors what the user was last using.
  const focused = entries.filter((e) => e.id === focusedId);
  const others = entries.filter((e) => e.id !== focusedId);
  const ordered = [...focused, ...others];

  const tabs: SessionSnapshot["tabs"] = [];
  const seen = new Set<string>();
  for (const e of ordered) {
    for (const t of e.snap.tabs) {
      // The same project can be open in two windows; restore only rebuilds one.
      if (seen.has(t.root)) continue;
      seen.add(t.root);
      tabs.push(t);
    }
  }
  const activeRoot =
    ordered.find((e) => e.snap.activeRoot !== null)?.snap.activeRoot ?? null;
  // Keep a split only if BOTH members survived the dedup, so restore can never
  // be handed a pair it cannot rebuild.
  const split =
    ordered.find(
      (e) =>
        e.snap.split && seen.has(e.snap.split.a) && seen.has(e.snap.split.b),
    )?.snap.split ?? null;
  return { version: 1, tabs, activeRoot, split };
}
