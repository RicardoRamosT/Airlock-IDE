import os from "node:os";
import path from "node:path";
import { app } from "electron";
import {
  installQuotaStatusLine,
  isQuotaInstalled,
  type QuotaPaths,
  uninstallQuotaStatusLine,
} from "./install";
import { startQuotaWatch, stopQuotaWatch } from "./watch";

// Resolve every path + the emitter location. Centralized so startup and the
// prefs:set reconcile share identical wiring. The emitter ships via
// extraResources (process.resourcesPath) in production; in dev it sits in the
// repo, resolved relative to the built main dir (out/main -> ../../resources).
export function quotaPaths(): QuotaPaths {
  const quotaDir = path.join(app.getPath("userData"), "quota");
  const emitScript = app.isPackaged
    ? path.join(process.resourcesPath, "statusline-emit.sh")
    : path.join(__dirname, "../../resources/statusline-emit.sh");
  return {
    settingsPath: path.join(os.homedir(), ".claude", "settings.json"),
    bookkeepingPath: path.join(quotaDir, "install.json"),
    emitConfigPath: path.join(quotaDir, "emit-config.sh"),
    outPath: path.join(quotaDir, "rate-limits.json"),
    emitScript,
  };
}

// Serialize every reconcile so two interleaving install/uninstall passes (the
// startup reconcile racing a fast toggle, or two windows both flipping the
// pref) can never read the same settings.json baseline and lose the user's
// prior statusLine. Same read-modify-write hazard prefs.ts guards (audit
// PB-H13). All callers go through reconcileQuotaMeter, so one chain suffices.
let chain: Promise<void> = Promise.resolve();

// Reconcile the on-disk Claude statusLine + the watcher to match `enabled`.
// Best-effort: callers swallow/log so a settings.json write failure never
// crashes the app.
export function reconcileQuotaMeter(enabled: boolean): Promise<void> {
  const run = chain.then(() => reconcileNow(enabled));
  // Keep a non-rejecting tail so a failed reconcile can't wedge the queue.
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function reconcileNow(enabled: boolean): Promise<void> {
  const p = quotaPaths();
  if (enabled) {
    await installQuotaStatusLine(p);
    startQuotaWatch(p.outPath);
  } else {
    // Opt-out default: only touch disk if we actually installed before, so the
    // feature is a true no-op (no userData state, no ~/.claude read/write) for
    // users who never enable it. Stop the watcher and drop the cached status so
    // re-enabling shows "waiting" rather than flashing stale numbers.
    if (await isQuotaInstalled(p)) await uninstallQuotaStatusLine(p);
    await stopQuotaWatch();
  }
}
