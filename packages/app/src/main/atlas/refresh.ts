// ASCII comments only. One refresh cycle: discover roots, fold them into the
// durable registry, record which still exist, collect their state, and store
// the result under the user's LOCAL calendar day.
//
// This is the free half of Atlas. It spends no model tokens and may therefore
// run on a timer -- unlike the composer, which never does.

import {
  type AtlasProject,
  applyPresenceResults,
  type CollectDeps,
  collectAll,
  detectConcerns,
  mergeRegistry,
  type RootPresence,
  type RootSnapshot,
  reconcileConcerns,
  seedRoots,
} from "@airlock/agent-core";
import type { AtlasDb } from "./dbOps";
// dayKey is pure, so it stays a direct import: only DATABASE work crosses the
// process boundary.
import { dayKey } from "./store";

export interface RefreshInput {
  db: AtlasDb;
  deps: CollectDeps;
  // Does each root still exist. INJECTED, like every other probe here: this
  // function is unit-tested against stub deps, and reaching for the real
  // filesystem would make its result depend on paths the test never created.
  // Production passes probeRoots.
  probe: (roots: readonly string[]) => Promise<Map<string, RootPresence>>;
  recentFolders: readonly string[];
  openTabRoots: readonly string[];
  now: number;
  tzOffsetMinutes: number;
  sinceMs: number;
}

// Returns the projects ALONGSIDE the snapshots. The caller needs to know which
// are enabled, and this function has just written the registry -- asking the
// database a second time for a table it has this moment rewritten is both
// wasteful and a chance for the two answers to disagree.
export interface RefreshResult {
  snaps: RootSnapshot[];
  projects: AtlasProject[];
}

export async function refreshPortfolio(
  input: RefreshInput,
): Promise<RefreshResult> {
  const { db, deps, now } = input;

  const discovered = seedRoots(input.recentFolders, input.openTabRoots);
  const merged = mergeRegistry(await db.readRegistry(), discovered, now);

  const snaps = await collectAll(
    deps,
    merged.map((p) => p.root),
    input.sinceMs,
  );

  // The SAME probe the project list uses, rather than re-deriving presence
  // from the snapshots. collectRoot's `missing` is a boolean -- it cannot say
  // "could not tell" -- so reading it here would reintroduce the collapse of
  // "gone" and "unreadable" that probeRoot exists to undo. One rule, one
  // place, so the debrief and the settings list cannot disagree about whether
  // a project still exists.
  const projects = applyPresenceResults(
    merged,
    await input.probe(merged.map((p) => p.root)),
    now,
  );
  await db.writeRegistry(projects);

  // Standing concerns, folded in here because this is the one place that is
  // already free: pure detection over data just collected, no model call. Tier
  // 1 is always-on precisely because it costs nothing.
  //
  // coveredRoots is EVERY root the collector produced a snapshot for, missing
  // ones included -- a missing folder is a successful observation. A root that
  // errored yields no snapshot and so is absent here, which is what stops its
  // concerns being silently resolved.
  const coveredRoots = new Set(snaps.map((s) => s.root));
  await db.writeConcerns(
    reconcileConcerns(
      await db.readConcerns(),
      detectConcerns(snaps, await db.readFacts(), now),
      coveredRoots,
      now,
    ),
  );
  await db.saveSnapshot(
    dayKey(now, input.tzOffsetMinutes),
    input.sinceMs,
    snaps,
  );
  return { snaps, projects };
}
