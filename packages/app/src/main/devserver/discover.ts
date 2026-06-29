import { spawnSync } from "node:child_process";

// Pure: parse `lsof -nP -iTCP -sTCP:LISTEN -FpPn` field output. Fields come as
// lines: `p<pid>` starts a process block, `n<addr>` is an address for the
// current pid. We map each LISTEN address to { pid, port }.
// Real lsof -FpPn output also includes `f<fd>` and protocol lines (e.g. "PTCP")
// between p and n lines — those are ignored since they don't start with p or n.
export function parseLsofPorts(
  out: string,
): Array<{ pid: number; port: number }> {
  const ports: Array<{ pid: number; port: number }> = [];
  let pid: number | null = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("p")) {
      const n = Number(line.slice(1));
      pid = Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : null;
    } else if (line.startsWith("n") && pid !== null) {
      const m = line.match(/:(\d+)$/); // trailing :PORT of *:PORT / 127.0.0.1:PORT / [::1]:PORT
      if (m?.[1] !== undefined) {
        ports.push({ pid, port: Number(m[1]) });
      }
    }
  }
  return ports;
}

// Pure: from `ps -Ao pid=,ppid=` rows, the set of rootPid + all its descendants.
export function parsePsSubtree(out: string, rootPid: number): Set<number> {
  const children = new Map<number, number[]>();
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (m === null) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    const arr = children.get(ppid) ?? [];
    arr.push(pid);
    children.set(ppid, arr);
  }
  const result = new Set<number>([rootPid]);
  const stack: number[] = [rootPid];
  while (stack.length > 0) {
    const p = stack.pop();
    if (p === undefined) break;
    for (const c of children.get(p) ?? []) {
      if (!result.has(c)) {
        result.add(c);
        stack.push(c);
      }
    }
  }
  return result;
}

// Impure wrappers (thin; not unit-tested). Best-effort: missing/erroring tool -> empty.
export function listeningPorts(): Array<{ pid: number; port: number }> {
  try {
    const r = spawnSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-FpPn"], {
      encoding: "utf8",
    });
    if (r.error !== undefined || typeof r.stdout !== "string") return [];
    return parseLsofPorts(r.stdout);
  } catch {
    return [];
  }
}

export function subtreePids(rootPid: number): Set<number> {
  try {
    const r = spawnSync("ps", ["-Ao", "pid=,ppid="], { encoding: "utf8" });
    if (r.error !== undefined || typeof r.stdout !== "string")
      return new Set([rootPid]);
    return parsePsSubtree(r.stdout, rootPid);
  } catch {
    return new Set([rootPid]);
  }
}
