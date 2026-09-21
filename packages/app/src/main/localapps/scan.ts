// Turning what is running into the set of notices the bell should show.
//
// ASCII-only comments and string literals (CJS-bundled into Electron main).
//
// The SELECTION is pure and the gathering is thin, so the rules that decide
// what counts -- and what is deliberately excluded -- are unit-tested rather
// than argued about.

import path from "node:path";
import {
  type Container,
  dockerContainers,
  dockerStartedAt,
} from "@airlock/agent-core";
import { isOverThreshold } from "../../shared/agentRequests";
import type { LongRunningAppInput } from "../agent-requests";
import { listeningPorts } from "../devserver/discover";
import {
  attributeToRoot,
  cwdsForPids,
  type ProcInfo,
  processAges,
  shortCommand,
  subtreeOf,
} from "./detect";

function projectNameOf(root: string | null): string | null {
  return root ? path.basename(root) : null;
}

/**
 * Containers that have been up longer than the threshold.
 *
 * Only RUNNING containers: a stopped one costs nothing, which is the whole
 * point. Age comes from the engine's StartedAt -- never from `docker ps`'s
 * RunningFor, which counts from CREATED and reported a container restarted
 * yesterday as "4 weeks" old.
 *
 * A container whose start time could not be read is SKIPPED rather than
 * assumed old: telling someone to stop something on a guess is worse than
 * staying quiet.
 */
export function longRunningContainers(
  containers: readonly Container[],
  startedAt: ReadonlyMap<string, number>,
  now: number,
  thresholdHours: number,
): LongRunningAppInput[] {
  const out: LongRunningAppInput[] = [];
  for (const c of containers) {
    if (c.state !== "running") continue;
    const started = startedAt.get(c.id);
    if (started === undefined) continue;
    if (!isOverThreshold(started, now, thresholdHours)) continue;
    out.push({
      appType: "container",
      appId: c.id,
      name: c.name,
      detail: c.image,
      startedAt: started,
      // The compose labels added for container scoping: a notice lands in the
      // window owning that project rather than wherever focus happens to be.
      root: c.projectDir,
      projectName: c.project ?? projectNameOf(c.projectDir),
    });
  }
  return out;
}

/**
 * Listening processes that belong to one of the user's projects and have been
 * up longer than the threshold.
 *
 * A process qualifies on its WORKING DIRECTORY, not its port: the server that
 * motivated this listens on 3005, which no dev-port list contains. That also
 * means unrelated software never qualifies -- the OS and background daemons do
 * not run out of a project directory.
 *
 * `excludePids` is AirLock's own subtree. Run from source its cwd IS a project
 * root, so without this AirLock reports itself.
 *
 * One notice per PID, not per port: a server bound to both IPv4 and IPv6, or to
 * several ports, is still one app to stop.
 */
export function longRunningProcesses(
  listening: readonly { pid: number; port: number }[],
  cwds: ReadonlyMap<number, string>,
  ages: ReadonlyMap<number, ProcInfo>,
  roots: readonly string[],
  now: number,
  thresholdHours: number,
  excludePids: ReadonlySet<number>,
  managedPorts: ReadonlySet<number>,
): LongRunningAppInput[] {
  const byPid = new Map<string, LongRunningAppInput>();
  for (const { pid, port } of listening) {
    if (excludePids.has(pid)) continue;
    const cwd = cwds.get(pid);
    const info = ages.get(pid);
    if (cwd === undefined || info === undefined) continue;
    const root = attributeToRoot(cwd, roots);
    if (root === null) continue;
    if (!isOverThreshold(info.startedAt, now, thresholdHours)) continue;
    const key = String(pid);
    const existing = byPid.get(key);
    if (existing) {
      // Same process, another port: keep the lowest, which is the one a human
      // recognises as "the" port.
      if (port < Number(existing.appId)) existing.appId = String(port);
      continue;
    }
    byPid.set(key, {
      // Managed and detected differ ONLY in how they are stopped; the age and
      // the attribution are read the same way for both.
      appType: managedPorts.has(port) ? "managedServer" : "detectedServer",
      appId: String(port),
      name: `${projectNameOf(root)} on :${port}`,
      detail: shortCommand(info.command),
      startedAt: info.startedAt,
      root,
      projectName: projectNameOf(root),
      pid,
    });
  }
  return [...byPid.values()];
}

export interface ScanDeps {
  roots: () => string[];
  managedPorts: () => Set<number>;
  now: () => number;
  selfPid: () => number;
}

/**
 * One pass: three probes (docker ps, docker inspect, ps) plus one lsof.
 *
 * Every probe degrades to empty rather than throwing -- a missing docker or a
 * refused lsof must not take the poll down, and a quiet poll is a correct
 * outcome when nothing can be read.
 */
export async function scanLocalApps(
  deps: ScanDeps,
  thresholdHours: number,
): Promise<LongRunningAppInput[]> {
  const now = deps.now();
  const roots = deps.roots();

  const ages = processAges(now);
  const listening = listeningPorts();
  const self = subtreeOf(ages, deps.selfPid());
  const pids = [...new Set(listening.map((l) => l.pid))].filter(
    (p) => !self.has(p),
  );
  const procs = longRunningProcesses(
    listening,
    cwdsForPids(pids),
    ages,
    roots,
    now,
    thresholdHours,
    self,
    deps.managedPorts(),
  );

  let containers: LongRunningAppInput[] = [];
  const status = await dockerContainers().catch(() => null);
  if (status?.running) {
    const running = status.containers.filter((c) => c.state === "running");
    containers = longRunningContainers(
      running,
      await dockerStartedAt(running.map((c) => c.id)),
      now,
      thresholdHours,
    );
  }
  return [...containers, ...procs];
}
