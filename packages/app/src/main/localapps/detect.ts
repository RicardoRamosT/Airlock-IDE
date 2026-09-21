// Finding local apps that have been running a long time.
//
// ASCII-only comments and string literals: this file is CJS-bundled into the
// Electron main process and Electron's cjs_lexer crashes on multibyte chars.
//
// TWO SOURCES, because they are genuinely different things:
//   - Docker containers, whose age comes from the engine.
//   - Listening PROCESSES, which covers an AirLock-managed dev server and a
//     detached one equally. Age comes from the process itself, so it survives
//     an AirLock restart -- a manager timestamp would not, and the server that
//     prompted this feature had outlived several.
//
// WHY NOT A PORT LIST. The obvious filter is the existing COMMON_DEV_PORTS,
// and it is wrong here: the server that motivated the feature listens on 3005,
// which is not in it, and extending the list is whack-a-mole. A process is one
// of the user's apps when its WORKING DIRECTORY is inside one of their open
// projects. That is precise, it attributes the app to a project for free, and
// it cannot start policing unrelated software -- clamd and the OS never match.

import { spawnSync } from "node:child_process";
import path from "node:path";

const PROBE_TIMEOUT_MS = 5000;

export interface ProcInfo {
  ppid: number;
  startedAt: number; // epoch ms
  command: string;
}

/**
 * Parse `ps` elapsed time -- `[[dd-]hh:]mm:ss` -- into seconds.
 *
 * etime rather than lstart because it is locale-independent: lstart renders
 * weekday and month names, which differ per system language and would make
 * parsing a guess.
 */
export function parseElapsed(s: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(s.trim());
  if (!m) return null;
  const [, d, h, mm, ss] = m;
  return (
    Number(d ?? 0) * 86400 +
    Number(h ?? 0) * 3600 +
    Number(mm) * 60 +
    Number(ss)
  );
}

/**
 * Parse `ps -Ao pid=,ppid=,etime=,command=` into pid -> info.
 *
 * `startedAt` is derived from `now` minus the elapsed time, so callers compare
 * absolute instants and the value stays stable across polls.
 *
 * ppid is carried so AirLock can exclude ITS OWN subtree: run from source, the
 * dev instance's working directory IS a project root, so without this AirLock
 * would report itself as a long-running app in its own repo.
 */
export function parsePsAges(out: string, now: number): Map<number, ProcInfo> {
  const res = new Map<number, ProcInfo>();
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line);
    if (!m?.[1] || !m[2] || !m[3]) continue;
    const secs = parseElapsed(m[3]);
    if (secs === null) continue;
    res.set(Number(m[1]), {
      ppid: Number(m[2]),
      startedAt: now - secs * 1000,
      command: (m[4] ?? "").trim(),
    });
  }
  return res;
}

/**
 * Every pid at or under `rootPid`, walking the ppid links.
 *
 * Iterates to a fixed point rather than recursing, so a cycle in a malformed
 * table cannot hang the main process.
 */
export function subtreeOf(
  table: Map<number, ProcInfo>,
  rootPid: number,
): Set<number> {
  const out = new Set<number>([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, info] of table)
      if (!out.has(pid) && out.has(info.ppid)) {
        out.add(pid);
        grew = true;
      }
  }
  return out;
}

/**
 * Parse `lsof -Fpn` field output into pid -> working directory.
 *
 * The format is one field per line, tagged by its first character: `p` opens a
 * process block, `n` carries the path. A `p` with no following `n` (a process
 * that exited between the two probes) simply contributes nothing.
 */
export function parseLsofCwds(out: string): Map<number, string> {
  const res = new Map<number, string>();
  let pid: number | null = null;
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith("p")) {
      const n = Number(line.slice(1));
      pid = Number.isFinite(n) ? n : null;
    } else if (line.startsWith("n") && pid !== null) {
      if (!res.has(pid)) res.set(pid, line.slice(1));
    }
  }
  return res;
}

/**
 * Which of `roots` owns `dir`, or null.
 *
 * Longest match wins, so a project nested inside another is attributed to the
 * inner one. Compared on path SEGMENTS (via a trailing separator), so
 * `/p/app-old` is never attributed to `/p/app` -- the sibling-prefix trap that
 * the Docker container scoping hit.
 */
export function attributeToRoot(
  dir: string,
  roots: readonly string[],
): string | null {
  let best: string | null = null;
  for (const r of roots) {
    const norm = r.endsWith(path.sep) ? r.slice(0, -1) : r;
    if (dir === norm || dir.startsWith(`${norm}${path.sep}`))
      if (best === null || norm.length > best.length) best = norm;
  }
  return best;
}

// A short label for a process, for the card. `ps` command strings run to
// hundreds of characters (a node binary path plus every flag), which no card
// can show, and the tail is never the informative part.
export function shortCommand(cmd: string, max = 60): string {
  const first = cmd.trim().split(/\s+/)[0] ?? "";
  const base = first.includes(path.sep) ? path.basename(first) : first;
  const rest = cmd.trim().slice(first.length).trim();
  const out = rest ? `${base} ${rest}` : base;
  return out.length > max ? `${out.slice(0, max - 3)}...` : out;
}

function run(cmd: string, args: string[]): string | null {
  try {
    const r = spawnSync(cmd, args, {
      encoding: "utf8",
      timeout: PROBE_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 8 * 1024 * 1024,
    });
    if (r.error !== undefined || typeof r.stdout !== "string") return null;
    return r.stdout;
  } catch {
    return null;
  }
}

// Working directory of each pid, in ONE lsof rather than one per pid: this runs
// on a timer, and a spawn per listening process is exactly the cost the feature
// exists to avoid.
export function cwdsForPids(pids: number[]): Map<number, string> {
  if (pids.length === 0) return new Map();
  const out = run("lsof", [
    "-b",
    "-a",
    "-d",
    "cwd",
    "-Fpn",
    "-p",
    pids.join(","),
  ]);
  return out === null ? new Map() : parseLsofCwds(out);
}

export function processAges(now: number): Map<number, ProcInfo> {
  const out = run("ps", ["-Ao", "pid=,ppid=,etime=,command="]);
  return out === null ? new Map() : parsePsAges(out, now);
}
