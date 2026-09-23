// The long-running local apps poll, and the Stop that acts on one.
//
// ASCII-only comments and string literals (CJS-bundled into Electron main).

import { dockerStop } from "@airlock/agent-core";
import { appIdentity } from "../../shared/agentRequests";
import {
  forgetLongRunningNotice,
  type LongRunningAppInput,
  longRunningNoticeById,
  reconcileLongRunningApps,
} from "../agent-requests";
import { stopDevServer } from "../devserver/manager";
import { allOpenRoots } from "../window";
import { scanLocalApps } from "./scan";

// A 24-hour threshold needs nothing finer, and this feature exists to SAVE
// battery -- polling it hard would be self-defeating. A Stop reconciles
// immediately, so the card never lingers for ten minutes after you act.
const POLL_MS = 10 * 60 * 1000;

// Identity -> pid, refreshed every scan. The pid stays here and never reaches
// the renderer: Stop is addressed by requestId and resolved to a pid in main.
const pidForApp = new Map<string, number>();

let timer: ReturnType<typeof setInterval> | null = null;

export interface LocalAppsDeps {
  // Reading the pref each poll, so toggling it takes effect without a restart.
  prefs: () => Promise<{ enabled: boolean; thresholdHours: number }>;
  // EVERY project AirLock knows, not just the open tabs. A dependency because
  // two of its three sources live behind async clients, and because the
  // compiler is then what forces a caller to say where the set comes from --
  // this used to be `allOpenRoots` inline, and nothing said that closing a tab
  // silently stopped monitoring that project's servers.
  knownRoots: () => Promise<readonly string[]>;
  // Ports AirLock started itself, so a managed server is stopped through the
  // manager rather than shot in the head.
  managedPorts: () => Set<number>;
  killProcess?: (pid: number, signal: NodeJS.Signals) => void;
}

let deps: LocalAppsDeps | null = null;

export function configureLocalApps(d: LocalAppsDeps): void {
  deps = d;
}

// Test seam: drop the timer and remembered pids.
export function __resetLocalApps(): void {
  if (timer) clearInterval(timer);
  timer = null;
  pidForApp.clear();
  deps = null;
}

export async function pollLocalApps(): Promise<void> {
  if (!deps) return;
  const cfg = await deps.prefs().catch(() => null);
  // Turned off -> retire every notice rather than freezing the last set on
  // screen with no way to refresh it.
  if (!cfg || !cfg.enabled) {
    pidForApp.clear();
    reconcileLongRunningApps([]);
    return;
  }
  // Resolved ONCE per poll, outside the scan, so the scan's root list stays a
  // plain array it can match against without awaiting mid-loop.
  const known = await deps.knownRoots().catch(() => allOpenRoots());
  let apps: LongRunningAppInput[] = [];
  try {
    apps = await scanLocalApps(
      {
        roots: () => [...known],
        managedPorts: deps.managedPorts,
        now: () => Date.now(),
        selfPid: () => process.pid,
      },
      cfg.thresholdHours,
    );
  } catch {
    // A probe failing must not tear down the poll; the next pass tries again.
    return;
  }
  pidForApp.clear();
  for (const a of apps)
    if (a.pid !== undefined) pidForApp.set(appIdentity(a), a.pid);
  reconcileLongRunningApps(apps);
}

export function startLocalAppsPoll(): void {
  if (timer) return;
  void pollLocalApps();
  timer = setInterval(() => void pollLocalApps(), POLL_MS);
  // Never hold the process open for a battery-saving poll.
  timer.unref?.();
}

export interface StopResult {
  ok: boolean;
  error?: string;
}

/**
 * Stop the app a notice describes.
 *
 * Addressed by REQUEST ID, never by pid or container id from the renderer: the
 * only things stoppable are things AirLock currently reports as long-running,
 * so this cannot be pointed at an arbitrary process.
 *
 * SIGTERM, not SIGKILL. A dev server asked politely flushes and exits; killing
 * it outright can leave a stale lockfile or a half-written build. If it ignores
 * the signal the next poll still lists it, which is honest.
 */
export async function stopLocalApp(requestId: string): Promise<StopResult> {
  const notice = longRunningNoticeById(requestId);
  if (!notice) return { ok: false, error: "No such notification" };
  try {
    if (notice.appType === "container") {
      await dockerStop(notice.appId);
    } else if (notice.appType === "managedServer" && notice.root) {
      // Through the manager, so its own state and UI follow.
      stopDevServer(notice.root);
    } else {
      const pid = pidForApp.get(appIdentity(notice));
      if (pid === undefined)
        return { ok: false, error: "That process is no longer running" };
      (deps?.killProcess ?? ((p, s) => process.kill(p, s)))(pid, "SIGTERM");
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  // The app is gone; retire the card now rather than at the next poll, then
  // re-scan so anything else that changed is reflected too.
  forgetLongRunningNotice(requestId);
  void pollLocalApps();
  return { ok: true };
}
