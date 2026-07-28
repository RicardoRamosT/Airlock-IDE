// Aggregates the per-section traffic-light dots for the activity rail. Lives in
// its own module (not ide-state) because it consumes BOTH ide-state and
// activity.ts — activity.ts already imports ide-state, so putting this here
// avoids an import cycle. The level decisions are the pure mappers in
// sectionDots.ts; this file only does the (impure) fetching, each guarded so
// one slow/failing probe degrades that dot to grey instead of breaking the rest.
import type { GitStatus, SectionStatuses } from "../shared/ipc";
import {
  databaseStatus,
  gitStatusFor,
  hostStatus,
  neonStatus,
  renderServicesStatus,
} from "./ide-state";
import { databasesDot, gitDot, hostDot } from "./sectionDots";

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

// Docker has no rail dot (like Slack/GitHub -- its live state lives in its own
// extension section, not the activity rail), so this deliberately does not
// fetch or compute one. See the 2026-07-27 extensions reclassification: DOTTED
// in ActivityBar.tsx dropped "docker" when it moved off the core rail; the
// SectionStatuses.docker field and this function's dockerStatus() call were
// its now-orphaned other half.
export async function sectionStatuses(
  root: string | null,
): Promise<SectionStatuses> {
  const [pg, neon, host, render, git] = await Promise.all([
    root ? safe(databaseStatus(root), []) : [],
    safe(neonStatus(root), { connected: false }),
    root
      ? safe(hostStatus(root), { url: null, up: null })
      : { url: null, up: null },
    root ? safe(renderServicesStatus(root), []) : [],
    root ? safe<GitStatus | null>(gitStatusFor(root), null) : null,
  ]);
  const renderLive = render.some((s) => s.deployStatus === "live");
  return {
    databases: databasesDot(pg, neon.connected),
    host: hostDot(host.up, host.url !== null, renderLive, render.length > 0),
    git: gitDot(git),
  };
}
