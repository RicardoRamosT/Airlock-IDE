import { describe, expect, it } from "vitest";
import {
  CLAUDE_WORKING_QUIET_MS,
  commandsIncludeClaude,
  computeSessionWorking,
  parsePsChildren,
} from "./claudeStatus";

describe("parsePsChildren", () => {
  it("maps ppid -> child command lines, preserving spaces in the command", () => {
    const ps = [
      "  4321  4319 node /x/claude/cli.js --flag",
      "  5000  4319 -zsh",
      "  6001  9999 /usr/local/bin/claude",
    ].join("\n");
    const m = parsePsChildren(ps);
    expect(m.get(4319)).toEqual(["node /x/claude/cli.js --flag", "-zsh"]);
    expect(m.get(9999)).toEqual(["/usr/local/bin/claude"]);
  });

  it("skips blank and non-numeric lines", () => {
    const ps = ["", "  PID PPID COMMAND", "  10  1 init"].join("\n");
    const m = parsePsChildren(ps);
    expect(m.size).toBe(1);
    expect(m.get(1)).toEqual(["init"]);
  });
});

describe("commandsIncludeClaude", () => {
  it("matches a bare claude command", () => {
    expect(commandsIncludeClaude(["claude"])).toBe(true);
  });
  it("matches an absolute claude path", () => {
    expect(commandsIncludeClaude(["/usr/local/bin/claude --resume"])).toBe(
      true,
    );
  });
  it("matches claude passed as an arg", () => {
    expect(commandsIncludeClaude(["node x claude"])).toBe(true);
  });
  it("does NOT match a mere path substring (claude in a dir name)", () => {
    // basenames are "node" and "server.js" -- no "claude" token.
    expect(commandsIncludeClaude(["node /Users/me/claude-app/server.js"])).toBe(
      false,
    );
  });
  it("is false for an empty list", () => {
    expect(commandsIncludeClaude([])).toBe(false);
  });
});

describe("computeSessionWorking", () => {
  const ps = ["  4321  4319 node x claude --resume", "  5000  7000 -bash"].join(
    "\n",
  );
  const now = 100_000;

  it("is working: claude child + recent output", () => {
    const out = computeSessionWorking(
      ps,
      [{ id: "s1", pid: 4319 }],
      new Map([["s1", now - 200]]),
      now,
    );
    expect(out).toEqual([{ id: "s1", working: true }]);
  });

  it("is NOT working: claude child but stale output", () => {
    const out = computeSessionWorking(
      ps,
      [{ id: "s1", pid: 4319 }],
      new Map([["s1", now - (CLAUDE_WORKING_QUIET_MS + 1)]]),
      now,
    );
    expect(out).toEqual([{ id: "s1", working: false }]);
  });

  it("is NOT working: no claude child even with recent output", () => {
    const out = computeSessionWorking(
      ps,
      [{ id: "s2", pid: 7000 }],
      new Map([["s2", now]]),
      now,
    );
    expect(out).toEqual([{ id: "s2", working: false }]);
  });

  it("is NOT working: session with no recorded last output", () => {
    const out = computeSessionWorking(
      ps,
      [{ id: "s1", pid: 4319 }],
      new Map(),
      now,
    );
    expect(out).toEqual([{ id: "s1", working: false }]);
  });
});
