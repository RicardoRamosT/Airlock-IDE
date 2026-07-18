// packages/app/src/main/dockstatus/watch.ts
// Poll the per-session side-channel dir, aggregate to a DockState, paint the
// dock. Focus acknowledges outstanding "done"s (green clears when you come back).
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { type FSWatcher, watch } from "chokidar";
import { app } from "electron";
import {
  aggregateDockState,
  parseSessionLine,
  type SessionEntry,
} from "./aggregate";
import { paintDock, resetPainted } from "./dock";

let watcher: FSWatcher | null = null;
let watchedDir: string | null = null;
let iconsDirRef = "";
let ackAt = 0;
let focusHooked = false;
let tick: ReturnType<typeof setInterval> | null = null;

const nowSec = () => Math.floor(Date.now() / 1000);

async function recompute(): Promise<void> {
  if (!watchedDir) return;
  const entries: SessionEntry[] = [];
  try {
    for (const name of await readdir(watchedDir)) {
      const line = await readFile(path.join(watchedDir, name), "utf8").catch(
        () => "",
      );
      const e = parseSessionLine(line);
      if (e) entries.push(e);
    }
  } catch {
    // dir vanished between event and read; treat as no sessions
  }
  paintDock(aggregateDockState(entries, ackAt, nowSec()), iconsDirRef);
}

function onFocus(): void {
  ackAt = nowSec();
  void recompute();
}

// usePolling (NOT native fs.watch): a native handle goes silent across macOS
// sleep/wake + long App-Nap and never re-arms (diagnosed 2026-06-11 for the
// quota watcher); polling self-heals.
export function startDockWatch(sessionsDir: string, iconsDir: string): void {
  iconsDirRef = iconsDir;
  if (watchedDir === sessionsDir && watcher) return;
  void stopDockWatch();
  watchedDir = sessionsDir;
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
  // WORKING_STALE_SECONDS actually clear it to idle (grey).
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
  resetPainted();
  // Only reset the dock if we ever painted it (iconsDirRef is set once
  // startDockWatch runs). Keeps disable a true no-op for opt-out users who never
  // started -- we must not touch the dock icon for them.
  if (iconsDirRef) paintDock("idle", iconsDirRef);
}
