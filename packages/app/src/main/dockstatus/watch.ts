// packages/app/src/main/dockstatus/watch.ts
// Poll the per-session side-channel dirs, aggregate to a DockState, paint the
// dock. Two sources joined by session_id: the hook-written PHASE dir (sessions/)
// and the statusLine-written LIVE dir (live/). Focus acknowledges outstanding
// "done"s (green clears when you come back).
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { type FSWatcher, watch } from "chokidar";
import { app, BrowserWindow } from "electron";
import {
  aggregateDockState,
  parseLivenessLine,
  parseSessionLine,
  type SessionEntry,
} from "./aggregate";
import { paintDock, resetPainted } from "./dock";

let watcher: FSWatcher | null = null;
let watchedDir: string | null = null;
let liveDirRef: string | null = null;
let iconsDirRef = "";
let ackAt = 0;
let focusHooked = false;
let tick: ReturnType<typeof setInterval> | null = null;

const nowSec = () => Math.floor(Date.now() / 1000);

// Liveness files for dead sessions (a crash or Esc-interrupt where SessionEnd
// never fires) would otherwise accumulate. A live session rewrites its file every
// ~5s, so anything older than this is certainly gone -> delete it opportunistically.
const LIVE_PRUNE_SECONDS = 300;

// Read the per-session statusLine heartbeats into sid -> epoch, pruning dead ones.
// Absent dir (dock live not provisioned) -> empty map -> aggregate falls back to
// the legacy phase-only staleness.
async function readLiveness(now: number): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (!liveDirRef) return m;
  let names: string[];
  try {
    names = await readdir(liveDirRef);
  } catch {
    return m;
  }
  for (const name of names) {
    const ts = parseLivenessLine(
      await readFile(path.join(liveDirRef, name), "utf8").catch(() => ""),
    );
    if (ts === null) continue;
    if (ts < now - LIVE_PRUNE_SECONDS) {
      void rm(path.join(liveDirRef, name), { force: true });
      continue;
    }
    m.set(name, ts);
  }
  return m;
}

async function recompute(): Promise<void> {
  if (!watchedDir) return;
  const now = nowSec();
  const liveBySid = await readLiveness(now);
  const entries: SessionEntry[] = [];
  try {
    for (const name of await readdir(watchedDir)) {
      const line = await readFile(path.join(watchedDir, name), "utf8").catch(
        () => "",
      );
      const p = parseSessionLine(line);
      if (p)
        entries.push({
          phase: p.state,
          phaseTs: p.ts,
          liveTs: liveBySid.get(name) ?? null,
        });
    }
  } catch {
    // dir vanished between event and read; treat as no sessions
  }
  // If an AirLock window is focused RIGHT NOW, treat any "done" as already seen:
  // a session finishing while you're looking should go straight to idle, not
  // flash green until you re-focus. (onFocus only fires on the focus transition.)
  if (BrowserWindow.getFocusedWindow()) ackAt = now;
  paintDock(aggregateDockState(entries, ackAt, now), iconsDirRef);
}

function onFocus(): void {
  ackAt = nowSec();
  void recompute();
}

// usePolling (NOT native fs.watch): a native handle goes silent across macOS
// sleep/wake + long App-Nap and never re-arms (diagnosed 2026-06-11 for the
// quota watcher); polling self-heals. Only the PHASE dir is watched for events;
// liveness freshness is picked up by the periodic tick (it changes every ~5s, so
// watching it too would just add recompute churn).
export function startDockWatch(
  sessionsDir: string,
  liveDir: string,
  iconsDir: string,
): void {
  iconsDirRef = iconsDir;
  liveDirRef = liveDir;
  if (watchedDir === sessionsDir && watcher) return;
  void stopDockWatch();
  watchedDir = sessionsDir;
  liveDirRef = liveDir;
  watcher = watch(sessionsDir, {
    ignoreInitial: false,
    usePolling: true,
    interval: 2000,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 30 },
  });
  const fire = () => void recompute();
  watcher.on("add", fire).on("change", fire).on("unlink", fire);
  if (!focusHooked) {
    app.on("browser-window-focus", onFocus);
    focusHooked = true;
  }
  // Periodic re-check: a `working` entry goes stale purely by time passing, and
  // NO file event fires when a session simply stops writing (turn ended, crash,
  // interrupt). Without this timer nothing re-runs the aggregation, so the dot
  // would stay yellow forever after activity stops. Re-aggregating on a tick lets
  // the staleness horizons actually clear it to idle (grey).
  tick = setInterval(() => void recompute(), 10_000);
  void recompute();
}

export async function stopDockWatch(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
  if (tick) {
    clearInterval(tick);
    tick = null;
  }
  watchedDir = null;
  liveDirRef = null;
  resetPainted();
  // Only reset the dock if we ever painted it (iconsDirRef is set once
  // startDockWatch runs). Keeps disable a true no-op for opt-out users who never
  // started -- we must not touch the dock icon for them.
  if (iconsDirRef) paintDock("idle", iconsDirRef);
}
