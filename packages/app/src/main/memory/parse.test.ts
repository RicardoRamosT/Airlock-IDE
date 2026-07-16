import { describe, expect, it } from "vitest";
import {
  assembleSample,
  buildDescendants,
  classifyProc,
  parseFootprintJson,
  parsePs,
} from "./parse";

const PS = [
  "46998     1 /Applications/AirLock.app/Contents/MacOS/AirLock",
  "47419 46998 /Applications/AirLock.app/Contents/Frameworks/AirLock Helper (Renderer).app/Contents/MacOS/AirLock Helper (Renderer) --type=renderer --user-data-dir=/x",
  "48142 46998 -zsh",
  "48417 48142 /Users/r/.local/bin/claude --mcp-config /Users/r/Library/Application Support/airlock/session-mcp/LendLogic.PnLAnalyzer-00d2c9fd/mcp-config.json",
  "35358 46998 /Applications/AirLock.app/Contents/MacOS/AirLock /opt/AirLock/lsp-server/lib/cli.mjs --stdio",
  "99999     1 /usr/sbin/cfprefsd",
].join("\n");

describe("parsePs", () => {
  it("splits pid, ppid, and the full command", () => {
    const rows = parsePs(PS);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({
      pid: 46998,
      ppid: 1,
      command: "/Applications/AirLock.app/Contents/MacOS/AirLock",
    });
    // command keeps its spaces
    expect(rows[3]?.command).toContain("--mcp-config");
  });

  it("ignores blank lines", () => {
    expect(parsePs("\n  \n")).toEqual([]);
  });
});

describe("buildDescendants", () => {
  it("returns main plus everything reachable through ppid, excluding unrelated procs", () => {
    const set = buildDescendants(parsePs(PS), 46998);
    expect([...set].sort((a, b) => a - b)).toEqual([
      35358, 46998, 47419, 48142, 48417,
    ]);
    expect(set.has(99999)).toBe(false); // ppid 1, not ours
  });
});

describe("parseFootprintJson", () => {
  it("normalizes footprint via bytes-per-unit and reads the total", () => {
    const json = JSON.stringify({
      unit: "byte",
      "bytes per unit": 1,
      "total footprint": 1_000_000_000,
      processes: [
        { pid: 46998, name: "AirLock", footprint: 94_000_000 },
        { pid: 48417, name: "claude", footprint: 650_000_000 },
      ],
    });
    const { byPid, total } = parseFootprintJson(json);
    expect(total).toBe(1_000_000_000);
    expect(byPid.get(48417)).toBe(650_000_000);
  });

  it("multiplies when bytes-per-unit is not 1 (e.g. pages)", () => {
    const json = JSON.stringify({
      unit: "page",
      "bytes per unit": 16384,
      "total footprint": 10,
      processes: [{ pid: 5, name: "x", footprint: 2 }],
    });
    const { byPid, total } = parseFootprintJson(json);
    expect(byPid.get(5)).toBe(32_768);
    expect(total).toBe(163_840);
  });
});

describe("classifyProc", () => {
  it("classifies AirLock main by the MacOS binary path", () => {
    expect(
      classifyProc("/Applications/AirLock.app/Contents/MacOS/AirLock"),
    ).toEqual({ kind: "airlock-main", project: null });
  });
  it("classifies AirLock helpers", () => {
    expect(
      classifyProc(
        "/Applications/AirLock.app/Contents/Frameworks/AirLock Helper (Renderer).app/Contents/MacOS/AirLock Helper (Renderer) --type=renderer",
      ).kind,
    ).toBe("airlock-helper");
  });
  it("classifies the language server by --stdio (before the AirLock-main check)", () => {
    expect(
      classifyProc(
        "/Applications/AirLock.app/Contents/MacOS/AirLock /opt/AirLock/lsp-server/lib/cli.mjs --stdio",
      ).kind,
    ).toBe("language-server");
  });
  it("classifies claude and extracts the project (hash stripped)", () => {
    expect(
      classifyProc(
        "/Users/r/.local/bin/claude --mcp-config /x/session-mcp/LendLogic.PnLAnalyzer-00d2c9fd/mcp-config.json",
      ),
    ).toEqual({ kind: "claude", project: "LendLogic.PnLAnalyzer" });
  });
  it("classifies shells and node", () => {
    expect(classifyProc("-zsh").kind).toBe("shell");
    expect(classifyProc("/bin/zsh").kind).toBe("shell");
    expect(classifyProc("node /x/y.js").kind).toBe("node");
  });
  it("falls back to other", () => {
    expect(classifyProc("/usr/sbin/cfprefsd").kind).toBe("other");
  });
});

describe("assembleSample", () => {
  const footprint = {
    byPid: new Map<number, number>([
      [46998, 94_000_000],
      [47419, 150_000_000],
      [48142, 3_000_000], // small -> rolled up
      [48417, 650_000_000],
      [35358, 1_300_000_000],
    ]),
    total: 2_197_000_000,
  };

  it("joins, classifies, sorts by footprint desc, and rolls up small procs", () => {
    const s = assembleSample(
      parsePs(PS),
      footprint,
      46998,
      1_700_000_000_000,
      20_000_000, // rollup threshold 20 MB
    );
    expect(s.available).toBe(true);
    expect(s.total).toBe(2_197_000_000);
    expect(s.updatedAt).toBe(1_700_000_000_000);
    // Non-rollup rows sorted desc by footprint
    const kinds = s.procs.map((p) => p.kind);
    expect(s.procs[0]).toMatchObject({ pid: 35358, kind: "language-server" });
    expect(s.procs[1]).toMatchObject({
      pid: 48417,
      kind: "claude",
      project: "LendLogic.PnLAnalyzer",
    });
    // The one sub-threshold proc (48142, 3 MB zsh) is folded into a rollup row
    const rollup = s.procs.find((p) => p.pid === -1);
    expect(rollup).toBeDefined();
    expect(rollup?.footprint).toBe(3_000_000);
    expect(kinds).not.toContain(undefined);
  });

  it("skips descendant pids that footprint did not measure (died mid-sample)", () => {
    const fp = { byPid: new Map([[46998, 94_000_000]]), total: 94_000_000 };
    const s = assembleSample(parsePs(PS), fp, 46998, 1, 20_000_000);
    expect(s.procs.every((p) => p.pid === 46998)).toBe(true);
  });
});
