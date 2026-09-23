// ASCII comments only. Fold what AirLock already knows into Atlas's registry.
//
// This exists because discovery used to be a SIDE EFFECT OF COMPOSING. The
// only callers of refreshPortfolio are maybeCompose, which sits behind
// shouldCompose (nothing before your chosen hour, nothing once today's brief
// exists), and the chat. So a project opened at 10am could not reach the
// registry until the next morning's debrief.
//
// That was invisible while every discovered project was automatically in the
// debrief: the lag just meant it appeared tomorrow. Opt-in made the registry
// the CONFIGURATION SURFACE, and a project you cannot see is a project you
// cannot enable -- so the lag became a block.
//
// refresh.ts already said this should be free to run on its own: "This is the
// free half of Atlas. It spends no model tokens and may therefore run on a
// timer -- unlike the composer, which never does." Discovery is the part of
// that half which costs nothing at all. It runs NO git, unlike
// refreshPortfolio, so it is cheap enough to do on every read of the list.
import {
  type AtlasProject,
  applyPresenceResults,
  mergeRegistry,
  type RootPresence,
  seedRoots,
} from "@airlock/agent-core";
import type { AtlasDb } from "./dbOps";

export async function discoverProjects(
  db: AtlasDb,
  recentFolders: readonly string[],
  openTabRoots: readonly string[],
  now: number,
  // Does each root still exist. Injected, like refreshPortfolio's: a test
  // works with fictional paths, and a real stat would report every one of
  // them gone. Production passes probeRoots.
  probe: (roots: readonly string[]) => Promise<Map<string, RootPresence>>,
): Promise<AtlasProject[]> {
  const merged = mergeRegistry(
    await db.readRegistry(),
    seedRoots(recentFolders, openTabRoots),
    now,
  );
  // PRESENCE ON EVERY READ, not once a day.
  //
  // Discovery has always been live in one direction only: open a folder and it
  // appears here at once, because mergeRegistry costs nothing. Removal was not
  // -- only refreshPortfolio could clear or set `missing`, and its two callers
  // (the morning compose and the chat's once-a-day snapshot) meant a folder
  // deleted at noon still read as fine until tomorrow. This list is the
  // CONFIGURATION SURFACE, so it has to be true when you look at it.
  //
  // Affordable for the same reason discovery is: one stat per project, no git
  // and no subprocess, against the per-root git refreshPortfolio spends.
  const projects = applyPresenceResults(
    merged,
    await probe(merged.map((p) => p.root)),
    now,
  );
  await db.writeRegistry(projects);
  return projects;
}
