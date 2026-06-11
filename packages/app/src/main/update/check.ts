// Polls GitHub releases for a newer version on a slow timer, caches the result,
// and broadcasts it. Gated on app.isPackaged: in dev there is no installed
// bundle to update, so we cache "no update" and never poll. Best-effort.
//
// ASCII-only comments (CJS-bundled into Electron main).
import { AIRLOCK_REPO, fetchLatestRelease, isNewer } from "@airlock/agent-core";
import { app, BrowserWindow } from "electron";
import type { UpdateStatus } from "../../shared/ipc";

const POLL_MS = 60 * 60_000; // hourly

let timer: ReturnType<typeof setInterval> | null = null;
let latest: UpdateStatus | null = null;

export function getUpdate(): UpdateStatus | null {
  return latest;
}

function broadcast(s: UpdateStatus): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.webContents.isDestroyed()) w.webContents.send("update:changed", s);
  }
}

async function tick(currentVersion: string): Promise<void> {
  try {
    const rel = await fetchLatestRelease(AIRLOCK_REPO);
    const available = !!rel && isNewer(currentVersion, rel.version);
    latest = {
      available,
      currentVersion,
      latestVersion: rel?.version ?? null,
      htmlUrl: rel?.htmlUrl ?? null,
      dmgUrl: rel?.dmgUrl ?? null,
    };
    broadcast(latest);
  } catch {
    // Keep the last good reading (or a no-update default); never throw.
    if (!latest) {
      latest = {
        available: false,
        currentVersion,
        latestVersion: null,
        htmlUrl: null,
        dmgUrl: null,
      };
      broadcast(latest);
    }
  }
}

export function startUpdateCheck(currentVersion: string): void {
  if (timer) return;
  if (!app.isPackaged) {
    latest = {
      available: false,
      currentVersion,
      latestVersion: null,
      htmlUrl: null,
      dmgUrl: null,
    };
    return; // no installed bundle to update in dev
  }
  void tick(currentVersion);
  timer = setInterval(() => void tick(currentVersion), POLL_MS);
}

export function stopUpdateCheck(): void {
  if (timer) clearInterval(timer);
  timer = null;
  latest = null;
}
