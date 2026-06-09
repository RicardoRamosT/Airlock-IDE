import { readFile, stat } from "node:fs/promises";
import { type FSWatcher, watch } from "chokidar";
import { BrowserWindow } from "electron";
import type { QuotaStatus } from "../../shared/ipc";
import { mergeQuota, parseQuota } from "./parse";

let watcher: FSWatcher | null = null;
let watchedPath: string | null = null;
let latest: QuotaStatus | null = null;

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
  let emittedAt: number;
  try {
    text = await readFile(outPath, "utf8");
    // Stamp with the file's mtime (when a Claude session last wrote it), NOT
    // read time -- so on app launch a long-untouched file is correctly seen as
    // stale ("no active session") instead of looking freshly updated.
    emittedAt = Math.floor((await stat(outPath)).mtimeMs / 1000);
  } catch {
    return; // file vanished between event and read; ignore
  }
  // Fold onto the last-known status so a fresh session's pre-first-response
  // emit (no rate_limits) carries old data forward instead of flashing
  // "unavailable".
  latest = mergeQuota(latest, parseQuota(text, emittedAt));
  broadcast(latest);
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
}
