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
  mergeRegistry,
  seedRoots,
} from "@airlock/agent-core";
import type { AtlasDb } from "./dbOps";

export async function discoverProjects(
  db: AtlasDb,
  recentFolders: readonly string[],
  openTabRoots: readonly string[],
  now: number,
): Promise<AtlasProject[]> {
  const merged = mergeRegistry(
    await db.readRegistry(),
    seedRoots(recentFolders, openTabRoots),
    now,
  );
  await db.writeRegistry(merged);
  return merged;
}
