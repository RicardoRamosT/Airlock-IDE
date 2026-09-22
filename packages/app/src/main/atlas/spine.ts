// The Atlas portfolio spine: one dot per open project, on the window's right
// edge.
//
// ASCII-only comments and string literals (CJS-bundled into Electron main).
//
// WHY THIS DOES NOT USE ATLAS'S LEDGER. collectLedger is called from exactly
// one place -- maybeCompose's standup dep -- and maybeCompose is idempotent per
// calendar day. The 15-minute interval in start.ts is a day-rollover backstop,
// not a refresh. So the ledger is gathered ONCE A DAY, and a dot built on it
// would show yesterday: fix a red CI at 10am and it stays red until tomorrow.
// A colour you cannot trust is worse than no colour, because you learn to
// ignore it.
//
// So the spine reads its own inputs, SPLIT BY COST: the local git call is
// cheap and runs often; the gh calls are expensive and run rarely, and only
// for open projects that have a remote.

import {
  type DotTone,
  dotState,
  gitStatus,
  type SpinePr,
} from "@airlock/agent-core";
import { BrowserWindow } from "electron";
import type { SpineDot } from "../../shared/ipc";
import { ciRunFor } from "../github/ciStatus";
import { openPrsFor } from "../github/openPrs";
import { allOpenRoots } from "../window";

export const SPINE_CHANNEL = "atlas:spine";

// 60s, not 30. This spawns a git process PER OPEN ROOT, so with ten tabs a 30s
// tier is 20 spawns a minute forever -- and an uncommitted-changes count does
// not need that resolution. The app ships a feature whose whole point is not
// burning battery in the background; this must not be the thing that does.
const LOCAL_MS = 60 * 1000;
const REMOTE_MS = 5 * 60 * 1000;

export interface SpineCacheEntry {
  tree: { dirty: number; branch: string | null; hasRemote: boolean } | null;
  ci: { status: string; conclusion: string | null } | null;
  prs: SpinePr[] | null;
}

const cache = new Map<string, SpineCacheEntry>();
let localTimer: ReturnType<typeof setInterval> | null = null;
let remoteTimer: ReturnType<typeof setInterval> | null = null;

// Test seam: drop the timers and the cache.
export function __resetSpine(): void {
  if (localTimer) clearInterval(localTimer);
  if (remoteTimer) clearInterval(remoteTimer);
  localTimer = null;
  remoteTimer = null;
  cache.clear();
}

function nameOf(root: string): string {
  const parts = root.split("/").filter((p) => p.length > 0);
  return parts.length > 0 ? (parts[parts.length - 1] as string) : root;
}

// One human line per tone. Deliberately short: this is a callout beside a 7px
// dot, not a report.
function lineFor(tone: DotTone, e: SpineCacheEntry | undefined): string {
  if (tone === "fail") return "CI is failing on this branch.";
  if (tone === "you") return "A pull request of yours is waiting for review.";
  if (tone === "clean") return "Clean. Nothing pending.";
  if (!e) return "Nothing read yet.";
  if (e.tree && e.tree.dirty > 0)
    return `${e.tree.dirty} uncommitted change${e.tree.dirty === 1 ? "" : "s"}.`;
  return "Quiet. Nothing to report.";
}

/**
 * Project the cache onto the open roots.
 *
 * EVERY open root gets a dot, including one nothing has been read for. Fixed
 * positions are the whole design: if a dot appeared only once its probe
 * returned, every dot below it would shift as results landed, and position
 * could never become muscle memory.
 */
export function projectDots(
  roots: readonly string[],
  entries: ReadonlyMap<string, SpineCacheEntry>,
): SpineDot[] {
  return roots.map((root) => {
    const e = entries.get(root);
    const tone = dotState({
      tree: e?.tree ?? null,
      ci: e?.ci ?? null,
      prs: e?.prs ?? null,
    });
    return { root, name: nameOf(root), tone, line: lineFor(tone, e) };
  });
}

/**
 * The dots as they stand right now, for a renderer that has just mounted.
 *
 * A push channel alone is HALF A CONTRACT: main sends its first broadcast at
 * startup, before any window has mounted and subscribed, so without this the
 * strip stayed empty until the next tick -- a full minute after launch, and
 * again after every renderer reload. The agent-request surface documents the
 * same rule: the snapshot is the half that survives a reload.
 *
 * With an empty cache this still returns one QUIET dot per open project, so
 * the strip is present from the first paint and only the colours arrive late.
 */
export function spineDots(): SpineDot[] {
  return projectDots(allOpenRoots(), cache);
}

function broadcast(): void {
  const dots = projectDots(allOpenRoots(), cache);
  // EVERY window, not just app windows: the Atlas popover and the standalone
  // Atlas window are not app windows, the same trap activityBridge documents.
  for (const w of BrowserWindow.getAllWindows())
    if (!w.isDestroyed() && !w.webContents.isDestroyed())
      w.webContents.send(SPINE_CHANNEL, dots);
}

function entryFor(root: string): SpineCacheEntry {
  const found = cache.get(root);
  if (found) return found;
  const fresh: SpineCacheEntry = { tree: null, ci: null, prs: null };
  cache.set(root, fresh);
  return fresh;
}

// Local tier: one git call per open root. No network, so it can run often.
async function pollLocal(): Promise<void> {
  for (const root of allOpenRoots()) {
    try {
      const st = await gitStatus(root);
      entryFor(root).tree = {
        dirty: st.staged.length + st.unstaged.length + st.untracked.length,
        branch: st.branch.head,
        hasRemote: st.branch.upstream !== null,
      };
    } catch {
      // Leave the last known value rather than flapping the dot to quiet.
    }
  }
  broadcast();
}

// Remote tier: two gh calls per open root WITH A REMOTE. Skipping the rest is
// what keeps this affordable -- a local-only project would otherwise pay two
// failing subprocesses every five minutes forever.
async function pollRemote(): Promise<void> {
  for (const root of allOpenRoots()) {
    const e = entryFor(root);
    if (e.tree && !e.tree.hasRemote) continue;
    try {
      const ci = await ciRunFor(root);
      e.ci = ci
        ? { status: ci.run.status, conclusion: ci.run.conclusion }
        : null;
    } catch {
      // keep the last value
    }
    e.prs = await openPrsFor(root);
  }
  broadcast();
}

/**
 * Start both tiers.
 *
 * Rides atlas.enabled: no Atlas, no spine, and no gh traffic for it either.
 * Checked on EVERY tick rather than once at startup, so turning Atlas off in
 * Settings stops the polling without a relaunch -- and turning it back on
 * resumes it. Clearing the cache on the disabled branch is what makes the
 * strip vanish and the workspace reclaim its column.
 */
export function startSpine(isEnabled: () => Promise<boolean>): void {
  if (localTimer) return;
  const guard = (poll: () => Promise<void>) => async () => {
    if (!(await isEnabled().catch(() => false))) {
      if (cache.size > 0) {
        cache.clear();
        broadcast();
      }
      return;
    }
    await poll();
  };
  const local = guard(pollLocal);
  const remote = guard(pollRemote);
  void local();
  void remote();
  localTimer = setInterval(() => void local(), LOCAL_MS);
  remoteTimer = setInterval(() => void remote(), REMOTE_MS);
  localTimer.unref?.();
  remoteTimer.unref?.();
}
