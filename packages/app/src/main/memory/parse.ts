// Pure helpers for the Usage dashboard Memory panel: turn a `ps` snapshot and
// the macOS `footprint` tool's JSON into a classified, footprint-attributed
// MemorySample. No I/O here (that is sample.ts) so this is fully unit-tested.
// ASCII-only comments: CJS-bundled into the Electron main process.
import type { MemKind, MemorySample, MemProc } from "../../shared/ipc";

export interface PsRow {
  pid: number;
  ppid: number;
  command: string;
}

// Parse `ps -axo pid=,ppid=,command=` output: first two whitespace-delimited
// tokens are pid + ppid; the rest of the line (spaces preserved) is command.
export function parsePs(text: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] ?? "" });
  }
  return rows;
}

// The pid set rooted at mainPid, following the ppid tree. Includes mainPid.
export function buildDescendants(rows: PsRow[], mainPid: number): Set<number> {
  const kids = new Map<number, number[]>();
  for (const r of rows) {
    const arr = kids.get(r.ppid) ?? [];
    arr.push(r.pid);
    kids.set(r.ppid, arr);
  }
  const seen = new Set<number>([mainPid]);
  const stack = [mainPid];
  while (stack.length) {
    const p = stack.pop() as number;
    for (const c of kids.get(p) ?? []) {
      if (!seen.has(c)) {
        seen.add(c);
        stack.push(c);
      }
    }
  }
  return seen;
}

// Read footprint's `-j` JSON. Values are in `unit` sized `bytes per unit`;
// normalize everything to bytes.
export function parseFootprintJson(text: string): {
  byPid: Map<number, number>;
  total: number;
} {
  const d = JSON.parse(text) as {
    "bytes per unit"?: number;
    "total footprint"?: number;
    processes?: { pid: number; footprint: number }[];
  };
  const mult = d["bytes per unit"] ?? 1;
  const byPid = new Map<number, number>();
  for (const p of d.processes ?? []) byPid.set(p.pid, p.footprint * mult);
  return { byPid, total: (d["total footprint"] ?? 0) * mult };
}

// Classify a process from its command string alone. Order matters: --stdio
// (the language server, spawned as Electron-as-node so its argv0 is the AirLock
// binary) is checked BEFORE the AirLock-main path check.
export function classifyProc(command: string): {
  kind: MemKind;
  project: string | null;
} {
  if (command.includes("--stdio"))
    return { kind: "language-server", project: null };
  if (command.includes("AirLock Helper"))
    return { kind: "airlock-helper", project: null };
  if (command.includes("/MacOS/AirLock"))
    return { kind: "airlock-main", project: null };
  const argv0 = command.trim().split(/\s+/)[0] ?? "";
  const base = argv0.split("/").pop() ?? argv0;
  if (base === "claude") {
    const m = command.match(/session-mcp\/([^/]+)\/mcp-config/);
    let project: string | null = null;
    if (m?.[1]) project = m[1].replace(/-[0-9a-f]{6,}$/, ""); // strip the -<hash> suffix
    return { kind: "claude", project };
  }
  if (
    base === "zsh" ||
    base === "-zsh" ||
    base === "bash" ||
    base === "-bash" ||
    base === "sh" ||
    base === "login"
  )
    return { kind: "shell", project: null };
  if (base === "node") return { kind: "node", project: null };
  return { kind: "other", project: null };
}

// Join the descendant ps rows with the footprint map, classify each, sort by
// footprint desc, and fold sub-threshold procs into one synthetic "N smaller
// processes" row (pid -1). total is footprint's own coalition total so the
// headline stays exact regardless of rollup or dropped pids.
export function assembleSample(
  rows: PsRow[],
  footprint: { byPid: Map<number, number>; total: number },
  mainPid: number,
  updatedAt: number,
  rollupBelowBytes = 20_000_000,
): MemorySample {
  const tree = buildDescendants(rows, mainPid);
  const big: MemProc[] = [];
  let rolledBytes = 0;
  let rolledCount = 0;
  for (const r of rows) {
    if (!tree.has(r.pid)) continue;
    const fp = footprint.byPid.get(r.pid);
    if (fp === undefined) continue; // died between snapshot and footprint
    const { kind, project } = classifyProc(r.command);
    const name =
      kind === "claude" && project ? project : nameFor(r.command, kind);
    if (fp < rollupBelowBytes) {
      rolledBytes += fp;
      rolledCount += 1;
      continue;
    }
    big.push({ pid: r.pid, name, kind, project, footprint: fp });
  }
  big.sort((a, b) => b.footprint - a.footprint);
  if (rolledCount > 0) {
    big.push({
      pid: -1,
      name: `${rolledCount} smaller process${rolledCount === 1 ? "" : "es"}`,
      kind: "other",
      project: null,
      footprint: rolledBytes,
    });
  }
  return {
    available: true,
    total: footprint.total,
    updatedAt,
    procs: big,
  };
}

// A short display name from the command for non-claude rows.
function nameFor(command: string, kind: MemKind): string {
  if (kind === "airlock-main") return "AirLock";
  if (kind === "airlock-helper") {
    const m = command.match(/--type=([a-z-]+)/);
    return m ? `AirLock Helper (${m[1]})` : "AirLock Helper";
  }
  if (kind === "language-server") return "language server";
  const argv0 = command.trim().split(/\s+/)[0] ?? command;
  return (argv0.split("/").pop() ?? argv0).replace(/^-/, "");
}
