// Aggregates the per-section traffic-light dots for the activity rail. Lives in
// its own module (not ide-state) because it consumes BOTH ide-state and
// activity.ts — activity.ts already imports ide-state, so putting this here
// avoids an import cycle. The level decisions are the pure mappers in
// sectionDots.ts; this file only does the (impure) fetching, each guarded so
// one slow/failing probe degrades that dot to grey instead of breaking the rest.
import type { GitStatus, SectionStatuses } from "../shared/ipc";
import { activityStatus } from "./activity";
import {
  databaseStatus,
  dockerStatus,
  gitStatusFor,
  hostStatus,
  neonStatus,
  renderServicesStatus,
} from "./ide-state";
import {
  activityDot,
  databasesDot,
  dockerDot,
  gitDot,
  hostDot,
} from "./sectionDots";

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export async function sectionStatuses(
  root: string | null,
): Promise<SectionStatuses> {
  const [docker, pg, neon, host, render, git, activity] = await Promise.all([
    safe(dockerStatus(), { installed: false, running: false, containers: [] }),
    root ? safe(databaseStatus(root), []) : [],
    safe(neonStatus(), { connected: false }),
    root
      ? safe(hostStatus(root), { url: null, up: null })
      : { url: null, up: null },
    root ? safe(renderServicesStatus(root), []) : [],
    root ? safe<GitStatus | null>(gitStatusFor(root), null) : null,
    safe(activityStatus(root), []),
  ]);
  const renderLive = render.some((s) => s.deployStatus === "live");
  return {
    docker: dockerDot(docker),
    databases: databasesDot(pg, neon.connected),
    host: hostDot(host.up, host.url !== null, renderLive, render.length > 0),
    git: gitDot(git),
    activity: activityDot(activity),
  };
}
