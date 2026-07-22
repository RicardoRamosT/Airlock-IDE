// Surfaces an available update and broadcasts it. Two sources: the GitHub
// release poll (all packaged builds) and -- in a dev build only -- a locally
// built bundle described by <userData>/dev-update.json. Local wins when newer.
// Gated: release builds have the local path dead-code-eliminated.
//
// ASCII-only comments (CJS-bundled into Electron main).
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  AIRLOCK_REPO,
  fetchLatestRelease,
  isLocalBuildNewer,
  isNewer,
  parseDevManifest,
} from "@airlock/agent-core";
import { type FSWatcher, watch } from "chokidar";
import { app, BrowserWindow } from "electron";
import type { UpdateStatus } from "../../shared/ipc";

const POLL_MS = 60 * 60_000; // hourly

// Compile-time gate. typeof guard so a stray import in tests (no define) is safe.
const DEV_UPDATE =
  typeof __AIRLOCK_DEV_UPDATE__ !== "undefined" && __AIRLOCK_DEV_UPDATE__;

let timer: ReturnType<typeof setInterval> | null = null;
let devWatcher: FSWatcher | null = null;
let latest: UpdateStatus | null = null;

export function getUpdate(): UpdateStatus | null {
  return latest;
}

function broadcast(s: UpdateStatus): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.webContents.isDestroyed()) w.webContents.send("update:changed", s);
  }
}

// GitHub release check (unchanged behavior): newest published release.
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
      localAppPath: null,
    };
    broadcast(latest);
  } catch {
    if (!latest) {
      latest = {
        available: false,
        currentVersion,
        latestVersion: null,
        htmlUrl: null,
        dmgUrl: null,
        localAppPath: null,
      };
      broadcast(latest);
    }
  }
}

function devManifestPath(): string {
  return path.join(app.getPath("userData"), "dev-update.json");
}

// Running .app bundle mtime (ms): exe is <bundle>/Contents/MacOS/AirLock.
async function runningBuiltAtMs(): Promise<number> {
  const bundle = path.resolve(app.getPath("exe"), "..", "..", "..");
  return (await stat(bundle)).mtimeMs;
}

// Dev channel: surface a newer local build (sets latest + returns true). Returns
// false WITHOUT touching latest when there is no usable/newer local build, so
// the caller falls back to GitHub.
async function surfaceLocalUpdate(currentVersion: string): Promise<boolean> {
  try {
    const m = parseDevManifest(
      JSON.parse(await readFile(devManifestPath(), "utf8")),
    );
    if (!m) return false;
    if (!isLocalBuildNewer(m.builtAt, await runningBuiltAtMs())) return false;
    latest = {
      available: true,
      currentVersion,
      latestVersion: `${m.version} (local)`,
      htmlUrl: null,
      dmgUrl: null,
      localAppPath: m.appPath,
    };
    broadcast(latest);
    return true;
  } catch {
    return false;
  }
}

async function recompute(currentVersion: string): Promise<void> {
  if (DEV_UPDATE && (await surfaceLocalUpdate(currentVersion))) return;
  await tick(currentVersion);
}

export function startUpdateCheck(currentVersion: string): void {
  if (timer || devWatcher) return;
  // Plain dev run of a release-flavor build: no bundle to update.
  if (!app.isPackaged && !DEV_UPDATE) {
    latest = {
      available: false,
      currentVersion,
      latestVersion: null,
      htmlUrl: null,
      dmgUrl: null,
      localAppPath: null,
    };
    return;
  }
  if (DEV_UPDATE) {
    // Polling watch (same reason as the other watchers: native fs.watch goes
    // silent across macOS sleep/wake). Button appears seconds after package:dev.
    devWatcher = watch(devManifestPath(), {
      ignoreInitial: false,
      usePolling: true,
      interval: 2000,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });
    const run = () => void recompute(currentVersion);
    devWatcher.on("add", run).on("change", run).on("unlink", run);
  }
  void recompute(currentVersion);
  timer = setInterval(() => void recompute(currentVersion), POLL_MS);
}

export function stopUpdateCheck(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (devWatcher) {
    void devWatcher.close();
    devWatcher = null;
  }
  latest = null;
}
