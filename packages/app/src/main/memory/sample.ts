// Thin spawn wiring for the Memory panel: snapshot `ps`, footprint AirLock's
// descendant tree, and assemble a MemorySample. Kept thin + untested (mirrors
// fsWatch.ts); all logic lives in parse.ts. macOS only; fails soft otherwise.
// ASCII-only comments: CJS-bundled into the Electron main process.
import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { MemorySample } from "../../shared/ipc";
import {
  assembleSample,
  buildDescendants,
  parseFootprintJson,
  parsePs,
} from "./parse";

const execFileP = promisify(execFile);

const UNAVAILABLE: MemorySample = {
  available: false,
  total: 0,
  updatedAt: 0,
  procs: [],
};

export async function sampleMemory(): Promise<MemorySample> {
  if (process.platform !== "darwin")
    return { ...UNAVAILABLE, updatedAt: Date.now() };
  try {
    // 1) Snapshot the process table and derive AirLock's descendant pids.
    const { stdout: psOut } = await execFileP(
      "ps",
      ["-axo", "pid=,ppid=,command="],
      { maxBuffer: 8 * 1024 * 1024, timeout: 5000 },
    );
    const rows = parsePs(psOut);
    const tree = buildDescendants(rows, process.pid);
    const pids = [...tree].map(String);
    if (pids.length === 0) return { ...UNAVAILABLE, updatedAt: Date.now() };

    // 2) In the same tick, footprint exactly those pids to a temp JSON file.
    //    Unique per call so overlapping polls cannot corrupt each other.
    const out = path.join(
      tmpdir(),
      `airlock-fp-${process.pid}-${Date.now()}.json`,
    );
    try {
      await execFileP("/usr/bin/footprint", ["-j", out, ...pids], {
        timeout: 5000,
      });
      const json = await readFile(out, "utf8");
      const footprint = parseFootprintJson(json);
      return assembleSample(rows, footprint, process.pid, Date.now());
    } finally {
      await rm(out, { force: true }).catch(() => {});
    }
  } catch (err) {
    console.error(
      "[memory] sample failed:",
      err instanceof Error ? err.message : String(err),
    );
    return { ...UNAVAILABLE, updatedAt: Date.now() };
  }
}
