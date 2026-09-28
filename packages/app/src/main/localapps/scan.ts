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
  type DockerStatus,
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
} from "./detect";

function projectNameOf(root: string | null): string | null {
  return root ? path.basename(root) : null;
}

/**
 * Every directory AirLock knows to be one of your projects.
 *
 * This is the set a listening process is qualified against, and widening it is
 * the whole fix: it used to be the OPEN TABS alone, so `attributeToRoot`
 * -- which answers "whose is it" -- was also deciding "is this one of your
 * apps at all", and a project with no tab failed both. A seven-day dev server
 * on :3005 was dropped before its age was read, purely because its project was
 * not open; the identical server in an open project was reported. Closing a
 * tab silently stopped the monitoring.
 *
 * It still cannot admit system software. Every daemon on the machine -- clamd,
 * OneDrive, rapportd, ControlCenter -- runs from "/", which is nobody's
 * project, and a blank entry is dropped because an empty string is a prefix of
 * everything.
 */
export function mergeProjectRoots(
  ...lists: readonly (readonly string[])[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const r of list) {
      const root = typeof r === "string" ? r.trim() : "";
      if (root.length === 0 || seen.has(root)) continue;
      seen.add(root);
      out.push(root);
    }
  }
  return out;
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
 * `excludePids` is AirLock's OWN processes -- see `ownPids`. Run from source
 * its cwd IS a project root, so without this AirLock reports itself.
 *
 * One notice per PID, not per port: a server bound to both IPv4 and IPv6, or to
 * several ports, is still one app to stop.
 *
 * And one owner per PORT, the OLDEST process listing it. A supervisor that
 * binds and then forks -- uvicorn --reload, gunicorn -- hands its worker the
 * SAME socket, so lsof lists the port under both pids and each would get a
 * card. The supervisor is the one to stop: SIGTERM to it takes the worker
 * down, while SIGTERM to the worker leaves the supervisor holding the port.
 * It is always the older of the two, because a parent starts before its child.
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
  const qualified: {
    pid: number;
    port: number;
    root: string;
    info: ProcInfo;
  }[] = [];
  for (const { pid, port } of listening) {
    if (excludePids.has(pid)) continue;
    const cwd = cwds.get(pid);
    const info = ages.get(pid);
    if (cwd === undefined || info === undefined) continue;
    const root = attributeToRoot(cwd, roots);
    if (root === null) continue;
    if (!isOverThreshold(info.startedAt, now, thresholdHours)) continue;
    qualified.push({ pid, port, root, info });
  }
  // ps ages have one-second resolution, so a parent and a child forked in the
  // same second tie; the lower pid breaks it, so the answer does not depend on
  // the order lsof happened to list them in.
  const ownerOfPort = new Map<number, (typeof qualified)[number]>();
  for (const q of qualified) {
    const cur = ownerOfPort.get(q.port);
    if (
      cur === undefined ||
      q.info.startedAt < cur.info.startedAt ||
      (q.info.startedAt === cur.info.startedAt && q.pid < cur.pid)
    )
      ownerOfPort.set(q.port, q);
  }

  const byPid = new Map<string, LongRunningAppInput>();
  for (const { pid, port, root, info } of qualified) {
    if (ownerOfPort.get(port)?.pid !== pid) continue;
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
  // AirLock's OWN processes -- Electron's main, renderer, GPU and utility
  // processes -- and NOT their descendants.
  //
  // It was the descendants: AirLock's whole process subtree was excluded, and
  // every terminal is in that subtree. So a server started from an AirLock
  // terminal -- by you, or by Claude's Bash tool, which is how nearly every dev
  // server here gets started -- was never reported however long it ran, and a
  // managed server (spawned into a pty AirLock owns) never could be. Only a
  // server that had DETACHED to ppid 1 was visible, which is why the ElArqui
  // case that motivated the feature worked. Observed 2026-09-28: three servers
  // up 1.5 to 4.5 days, every one AirLock -> zsh -> claude -> npm -> vite.
  ownPids: () => ReadonlySet<number>;
}

// The machine, as one pass reads it. A seam so the COMPOSITION is tested and
// not only the pure selectors either side of it: which pids get excluded, and
// which get probed, is decided in scanLocalApps itself.
export interface ScanProbes {
  processAges: (now: number) => Map<number, ProcInfo>;
  listeningPorts: () => { pid: number; port: number }[];
  cwdsForPids: (pids: number[]) => Map<number, string>;
  containers: () => Promise<DockerStatus>;
  containerStartedAt: (ids: string[]) => Promise<Map<string, number>>;
}

const LIVE_PROBES: ScanProbes = {
  processAges,
  listeningPorts,
  cwdsForPids,
  containers: () => dockerContainers(),
  containerStartedAt: (ids) => dockerStartedAt(ids),
};

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
  probes: ScanProbes = LIVE_PROBES,
): Promise<LongRunningAppInput[]> {
  const now = deps.now();
  const roots = deps.roots();

  const ages = probes.processAges(now);
  const listening = probes.listeningPorts();
  const self = deps.ownPids();
  const pids = [...new Set(listening.map((l) => l.pid))].filter(
    (p) => !self.has(p),
  );
  const procs = longRunningProcesses(
    listening,
    probes.cwdsForPids(pids),
    ages,
    roots,
    now,
    thresholdHours,
    self,
    deps.managedPorts(),
  );

  let containers: LongRunningAppInput[] = [];
  const status = await probes.containers().catch(() => null);
  if (status?.running) {
    const running = status.containers.filter((c) => c.state === "running");
    containers = longRunningContainers(
      running,
      await probes.containerStartedAt(running.map((c) => c.id)),
      now,
      thresholdHours,
    );
  }
  return [...containers, ...procs];
}
