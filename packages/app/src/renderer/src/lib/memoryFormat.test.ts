import { describe, expect, it } from "vitest";
import type { MemProc } from "../../../shared/ipc";
import { formatBytes, kindLabel, sortProcs } from "./memoryFormat";

describe("formatBytes", () => {
  it("uses decimal GB/MB/KB to match Activity Monitor", () => {
    expect(formatBytes(4_720_000_000)).toBe("4.7 GB");
    expect(formatBytes(94_000_000)).toBe("94 MB");
    expect(formatBytes(3_000_000)).toBe("3 MB");
    expect(formatBytes(512_000)).toBe("512 KB");
  });
});

describe("kindLabel", () => {
  it("maps kinds to human labels", () => {
    expect(kindLabel("claude")).toBe("Claude");
    expect(kindLabel("language-server")).toBe("Language server");
    expect(kindLabel("airlock-main")).toBe("AirLock");
    expect(kindLabel("airlock-helper")).toBe("AirLock helper");
  });
});

describe("sortProcs", () => {
  const procs: MemProc[] = [
    { pid: 2, name: "b", kind: "claude", project: "Beta", footprint: 100 },
    { pid: 1, name: "a", kind: "node", project: null, footprint: 300 },
    {
      pid: -1,
      name: "3 smaller processes",
      kind: "other",
      project: null,
      footprint: 50,
    },
  ];
  it("sorts by footprint desc but always keeps the rollup row (pid -1) last", () => {
    const s = sortProcs(procs, "footprint", "desc");
    expect(s.map((p) => p.pid)).toEqual([1, 2, -1]);
  });
  it("sorts ascending too, rollup still last", () => {
    const s = sortProcs(procs, "footprint", "asc");
    expect(s.map((p) => p.pid)).toEqual([2, 1, -1]);
  });
});
