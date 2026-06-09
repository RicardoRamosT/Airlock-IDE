import os from "node:os";
import path from "node:path";
import { app } from "electron";
import {
  installQuotaStatusLine,
  type QuotaPaths,
  uninstallQuotaStatusLine,
} from "./install";
import { startQuotaWatch } from "./watch";

// Resolve every path + the emitter location. Centralized so startup and the
// prefs:set reconcile share identical wiring. The emitter ships via
// extraResources (process.resourcesPath) in production; in dev it sits in the
// repo, resolved relative to the built main dir (out/main -> ../../resources).
export function quotaPaths(): QuotaPaths {
  const quotaDir = path.join(app.getPath("userData"), "quota");
  const emitScript = app.isPackaged
    ? path.join(process.resourcesPath, "statusline-emit.cjs")
    : path.join(__dirname, "../../resources/statusline-emit.cjs");
  return {
    settingsPath: path.join(os.homedir(), ".claude", "settings.json"),
    bookkeepingPath: path.join(quotaDir, "install.json"),
    emitConfigPath: path.join(quotaDir, "emit-config.json"),
    outPath: path.join(quotaDir, "rate-limits.json"),
    execPath: process.execPath,
    emitScript,
  };
}

// Reconcile the on-disk Claude statusLine to match `enabled`, then (re)start the
// watcher. The watcher always runs (idempotent) so a later enable is picked up
// without restart. Best-effort: callers swallow/log so a settings.json write
// failure never crashes the app.
export async function reconcileQuotaMeter(enabled: boolean): Promise<void> {
  const p = quotaPaths();
  if (enabled) await installQuotaStatusLine(p);
  else await uninstallQuotaStatusLine(p);
  startQuotaWatch(p.outPath);
}
