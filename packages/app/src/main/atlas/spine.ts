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
// cheap and runs every minute for every project; the gh calls are expensive
// and are rationed -- see REMOTE_BUDGET.
//
// WHOSE PROJECTS. The dots are the projects in ATLAS'S DEBRIEF, not the open
// tabs. The tab bar already shows what is open, and a second row saying the
// same thing is ambiguous rather than informative; the spine is for the
// portfolio you are responsible for, which is exactly the enabled set. The
// roots therefore arrive through a dependency rather than from window.ts, and
// this file stays free of electron so it can be unit-tested.

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

export const SPINE_CHANNEL = "atlas:spine";

// 60s, not 30. This spawns a git process PER OPEN ROOT, so with ten tabs a 30s
// tier is 20 spawns a minute forever -- and an uncommitted-changes count does
// not need that resolution. The app ships a feature whose whole point is not
// burning battery in the background; this must not be the thing that does.
const LOCAL_MS = 60 * 1000;

// The remote tier spends a FIXED BUDGET, not a per-project one.
//
// It used to poll EVERY root every five minutes, so its cost was 2 gh calls
// per project per cycle -- fine at the five open tabs it was written for, and
// a number that simply grows once the dots follow the debrief instead (a dozen
// projects, and it doubles again the day you add another). Now each tick takes
// the next REMOTE_BUDGET roots round-robin, so the call rate is constant
// whatever the portfolio does and only the time to come back round grows: a
// dozen projects refresh every six minutes, which is the same freshness the
// old five-minute sweep gave and at a rate that cannot run away.
const REMOTE_MS = 60 * 1000;
const REMOTE_BUDGET = 2;

export interface SpineCacheEntry {
  tree: { dirty: number; branch: string | null; hasRemote: boolean } | null;
  ci: { status: string; conclusion: string | null } | null;
  prs: SpinePr[] | null;
}

const cache = new Map<string, SpineCacheEntry>();
// The roots the last poll saw, so the IPC snapshot can answer without a
// database read and without being async.
let roots: string[] = [];
let cursor = 0;
let readRoots: (() => Promise<string[]>) | null = null;
let localTimer: ReturnType<typeof setInterval> | null = null;
let remoteTimer: ReturnType<typeof setInterval> | null = null;

// Test seam: drop the timers, the cache and the roots.
export function __resetSpine(): void {
  if (localTimer) clearInterval(localTimer);
  if (remoteTimer) clearInterval(remoteTimer);
  localTimer = null;
  remoteTimer = null;
  cache.clear();
  roots = [];
  cursor = 0;
  readRoots = null;
}

/**
 * The next `budget` items from `items`, starting at `cursor`, wrapping around.
 *
 * Pure so the rationing is testable: the bug it guards against is a slice that
 * silently never reaches the tail, which would leave the last projects in the
 * list permanently unread -- quiet dots that look like "nothing to report".
 */
export function nextSlice<T>(
  items: readonly T[],
  cursor: number,
  budget: number,
): { slice: T[]; next: number } {
  if (items.length === 0 || budget <= 0) return { slice: [], next: 0 };
  const start = ((cursor % items.length) + items.length) % items.length;
  const take = Math.min(budget, items.length);
  const slice: T[] = [];
  for (let i = 0; i < take; i += 1)
    slice.push(items[(start + i) % items.length] as T);
  return { slice, next: (start + take) % items.length };
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
  return projectDots(roots, cache);
}

/**
 * Re-read the watched projects and push the result.
 *
 * Called when the debrief's project list changes -- toggling one in Atlas
 * settings must move the strip immediately, not at the next tick. The new
 * project's dot is QUIET until a poll fills it, which is the honest answer:
 * nothing has been read for it yet.
 */
export async function refreshSpineRoots(): Promise<void> {
  if (readRoots === null) return;
  try {
    setRoots(await readRoots());
  } catch {
    return;
  }
  broadcast();
}

// Adopt a new root list and forget the cache of anything that left, so a
// project switched off does not come back with a stale colour.
function setRoots(next: readonly string[]): void {
  roots = [...next];
  const live = new Set(roots);
  for (const key of [...cache.keys()]) if (!live.has(key)) cache.delete(key);
}

function broadcast(): void {
  const dots = projectDots(roots, cache);
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

// Local tier: one git call per watched root. No network, so it can run often,
// and it is also what refreshes the root list the other tier rations over.
async function pollLocal(): Promise<void> {
  if (readRoots !== null) {
    try {
      setRoots(await readRoots());
    } catch {
      // Keep the last known list rather than emptying the strip.
    }
  }
  for (const root of roots) {
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

// Remote tier: two gh calls per root, for REMOTE_BUDGET roots per tick.
//
// Roots with no remote are filtered out BEFORE the slice rather than skipped
// inside it: a local-only project that consumed a slot would spend the budget
// on nothing and delay everything behind it, on top of paying two failing
// subprocesses forever. A root whose tree has not been read yet is eligible --
// unknown is not the same as no.
async function pollRemote(): Promise<void> {
  const eligible = roots.filter((r) => cache.get(r)?.tree?.hasRemote !== false);
  const { slice, next } = nextSlice(eligible, cursor, REMOTE_BUDGET);
  cursor = next;
  for (const root of slice) {
    const e = entryFor(root);
    try {
      // The branch is already in hand from the local tier, so ciRunFor is not
      // made to spawn its own git status for it. That was one redundant
      // process per root per cycle, which is exactly the kind of cost that
      // stops being invisible once the strip follows a portfolio.
      const ci = await ciRunFor(root, e.tree?.branch ?? null);
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
export function startSpine(deps: {
  enabled: () => Promise<boolean>;
  // The projects in the debrief. A dependency, not an import, because the
  // answer lives in Atlas's database behind an electron-only client and this
  // file must stay testable.
  roots: () => Promise<string[]>;
}): void {
  if (localTimer) return;
  readRoots = deps.roots;
  const guard = (poll: () => Promise<void>) => async () => {
    if (!(await deps.enabled().catch(() => false))) {
      if (cache.size > 0 || roots.length > 0) {
        cache.clear();
        roots = [];
        cursor = 0;
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
