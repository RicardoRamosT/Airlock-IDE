import type { ExtensionSummary } from "../../../shared/ipc";

// Does this extension belong in the FOCUSED project's sidebar?
//
// `projectUse` is computed main-side by projectUseOf (agent-core) and shipped
// with every summary, so the rail and the Databases/Host provider rows read
// ONE answer rather than each deciding. The three values mean:
//
//   "signal"  - the project declares the extension's own relevance signal, or
//               it is already connected here
//   "optedIn" - only the explicit "Use it here" override applies
//   "none"    - neither
//
// UNDEFINED is the important case: it means the question has no answer --
// either no project is focused, or the extension declares no relevance spec
// and so can never be irrelevant. Both must SHOW. Hiding on a missing answer
// would empty the sidebar during startup, before the first summary arrives.
export function isRelevantHere(e: {
  projectUse?: ExtensionSummary["projectUse"];
}): boolean {
  return e.projectUse !== "none";
}

// The ids to show, for consumers that have a list rather than a row.
export function relevantIds(all: ExtensionSummary[]): string[] {
  return all.filter(isRelevantHere).map((e) => e.id);
}

// Filter rows by the relevant set. NULL means the set has not arrived yet, and
// must keep everything -- the same NOT-ASKED-YET-vs-EMPTY distinction the
// Loading primitive exists for. Filtering on null would blank Databases and
// Host for the first second of every launch.
export function keepRelevant<T extends { id: string }>(
  rows: T[],
  relevant: string[] | null,
): T[] {
  return relevant === null ? rows : rows.filter((r) => relevant.includes(r.id));
}
