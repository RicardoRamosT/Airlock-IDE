import { readFile, stat } from "node:fs/promises";
import { type FSWatcher, watch } from "chokidar";
import { BrowserWindow } from "electron";
import type { QuotaStatus, SessionUsage } from "../../shared/ipc";
import {
  parseQuota,
  parseSessionMeta,
  parseSessionUsage,
  recordUsage,
} from "./parse";
import { QuotaTracker } from "./tracker";

let watcher: FSWatcher | null = null;
let watchedPath: string | null = null;
let latest: QuotaStatus | null = null;
// Per-session accumulator: the side-channel file is shared by every Claude
// session, so we track each session's reading and surface the most-recently-
// active one (an idle session re-emitting a stale snapshot must not win).
let tracker = new QuotaTracker();

// Per-session usage ledger for the Usage dashboard: latest snapshot per
// session since launch (capped; oldest-emit evicted). Unlike the tracker it
// is NOT pruned on idle -- history is the point.
let usageLedger = new Map<string, SessionUsage>();

export function getUsageLedger(): SessionUsage[] {
  return [...usageLedger.values()].sort(
    (a, b) => b.totalOutputTokens - a.totalOutputTokens,
  );
}

// Last-known status for a newly-opened window to fetch synchronously (quota:get).
export function getQuota(): QuotaStatus | null {
  return latest;
}

function broadcast(s: QuotaStatus): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.webContents.isDestroyed()) w.webContents.send("quota:changed", s);
  }
}

async function readAndBroadcast(outPath: string): Promise<void> {
  let text: string;
  let emitAt: number;
  try {
    text = await readFile(outPath, "utf8");
    emitAt = Math.floor((await stat(outPath)).mtimeMs / 1000);
  } catch {
    return; // file vanished between event and read; ignore
  }
  const meta = parseSessionMeta(text);
  const status = parseQuota(text, emitAt);
  const usage = parseSessionUsage(text, emitAt);
  if (usage) recordUsage(usageLedger, usage);
  // The tracker folds window values monotonically (account usage only climbs
  // within a window), so per-session activity ranking -- and the transcript
  // mtime stat it needed -- is gone.
  const best = tracker.record(meta.sessionId ?? outPath, status, emitAt);
  if (best) {
    latest = best;
    broadcast(best);
  }
}

// Watch the side-channel file. Idempotent: re-pointing to the same path is a
// no-op; a different path closes the old watcher. Safe before the file exists
// (chokidar fires `add` when the emitter first writes it).
export function startQuotaWatch(outPath: string): void {
  if (watchedPath === outPath && watcher) return;
  void stopQuotaWatch();
  watchedPath = outPath;
  watcher = watch(outPath, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 30 },
  });
  const fire = () => void readAndBroadcast(outPath);
  watcher.on("add", fire).on("change", fire);
}

export async function stopQuotaWatch(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
  watchedPath = null;
  latest = null;
  tracker = new QuotaTracker();
  usageLedger = new Map();
}
