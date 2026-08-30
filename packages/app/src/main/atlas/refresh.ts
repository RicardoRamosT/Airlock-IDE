// ASCII comments only. One refresh cycle: discover roots, fold them into the
// durable registry, record which still exist, collect their state, and store
// the result under the user's LOCAL calendar day.
//
// This is the free half of Atlas. It spends no model tokens and may therefore
// run on a timer -- unlike the composer, which never does.

import type { DatabaseSync } from "node:sqlite";
import {
  applyPresence,
  type CollectDeps,
  collectAll,
  mergeRegistry,
  type RootSnapshot,
  seedRoots,
} from "@airlock/agent-core";
import { dayKey, readRegistry, saveSnapshot, writeRegistry } from "./store";

export interface RefreshInput {
  db: DatabaseSync;
  deps: CollectDeps;
  recentFolders: readonly string[];
  openTabRoots: readonly string[];
  now: number;
  tzOffsetMinutes: number;
  sinceMs: number;
}

export async function refreshPortfolio(
  input: RefreshInput,
): Promise<RootSnapshot[]> {
  const { db, deps, now } = input;

  const discovered = seedRoots(input.recentFolders, input.openTabRoots);
  const merged = mergeRegistry(readRegistry(db), discovered, now);

  const snaps = await collectAll(
    deps,
    merged.map((p) => p.root),
    input.sinceMs,
  );

  const present = new Set(snaps.filter((s) => !s.missing).map((s) => s.root));
  writeRegistry(db, applyPresence(merged, present, now));
  saveSnapshot(db, dayKey(now, input.tzOffsetMinutes), input.sinceMs, snaps);
  return snaps;
}
