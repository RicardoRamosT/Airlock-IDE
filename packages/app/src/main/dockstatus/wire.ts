// packages/app/src/main/dockstatus/wire.ts
// Path resolution + reconcile for the dock-status feature. Mirrors quota/wire.ts.
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import {
  type DockStatusPaths,
  installDockStatusHooks,
  isDockStatusInstalled,
  uninstallDockStatusHooks,
} from "./install";
import { startDockWatch, stopDockWatch } from "./watch";

export function dockStatusPaths(): DockStatusPaths & { iconsDir: string } {
  const base = path.join(app.getPath("userData"), "dockstatus");
  const resources = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, "../../resources");
  return {
    settingsPath: path.join(os.homedir(), ".claude", "settings.json"),
    bookkeepingPath: path.join(base, "install.json"),
    emitConfigPath: path.join(base, "emit-config.sh"),
    sessionsDir: path.join(base, "sessions"),
    emitScript: path.join(resources, "airlock-dock-status.sh"),
    iconsDir: path.join(resources, "dock"),
  };
}

// Serialize reconciles (same read-modify-write hazard as reconcileQuotaMeter).
let chain: Promise<void> = Promise.resolve();

export function reconcileDockStatus(enabled: boolean): Promise<void> {
  const run = chain.then(() => reconcileNow(enabled));
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function reconcileNow(enabled: boolean): Promise<void> {
  // macOS only in v1: no dock to paint elsewhere, so never touch settings.json.
  if (process.platform !== "darwin") return;
  const p = dockStatusPaths();
  if (enabled) {
    await installDockStatusHooks(p);
    startDockWatch(p.sessionsDir, p.iconsDir);
  } else {
    // Opt-in default: only touch disk if we actually installed before, so the
    // feature is a true no-op for users who never enable it.
    if (await isDockStatusInstalled(p)) await uninstallDockStatusHooks(p);
    await stopDockWatch();
  }
}
