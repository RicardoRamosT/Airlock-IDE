import { describe, expect, it } from "vitest";
import { parseLsofPorts, parsePsSubtree } from "./discover";

describe("parseLsofPorts", () => {
  it("parses `lsof -nP -iTCP -sTCP:LISTEN -FpPn` field output into {pid,port}", () => {
    // lsof -F output: lines prefixed p<pid>, then n<addr> for that pid's files.
    const out = [
      "p501",
      "n*:5173",
      "p777",
      "n127.0.0.1:3000",
      "n[::1]:3000",
    ].join("\n");
    expect(parseLsofPorts(out)).toEqual([
      { pid: 501, port: 5173 },
      { pid: 777, port: 3000 },
      { pid: 777, port: 3000 },
    ]);
  });

  it("handles real lsof output with f<fd> and PTCP interleaved lines", () => {
    // Real lsof -FpPn output includes f<fd> and PTCP lines between p and n lines.
    const out = [
      "p1172",
      "f10",
      "PTCP",
      "n*:7000",
      "f11",
      "PTCP",
      "n*:5000",
      "p1428",
      "f3",
      "PTCP",
      "n127.0.0.1:3310",
    ].join("\n");
    expect(parseLsofPorts(out)).toEqual([
      { pid: 1172, port: 7000 },
      { pid: 1172, port: 5000 },
      { pid: 1428, port: 3310 },
    ]);
  });

  it("ignores malformed lines", () => {
    expect(parseLsofPorts("garbage\np\nnnoport")).toEqual([]);
  });
});

describe("parsePsSubtree", () => {
  it("collects all descendants of a root pid from `ps -o pid=,ppid=` rows", () => {
    const out = ["  100   1", "  200 100", "  300 200", "  400   1"].join("\n");
    expect([...parsePsSubtree(out, 100)].sort((a, b) => a - b)).toEqual([
      100, 200, 300,
    ]);
  });

  it("returns only the root when it has no children", () => {
    const out = ["  100   1", "  400   1"].join("\n");
    expect([...parsePsSubtree(out, 100)]).toEqual([100]);
  });
});
