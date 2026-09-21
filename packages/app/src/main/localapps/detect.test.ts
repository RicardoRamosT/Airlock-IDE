import { describe, expect, it } from "vitest";
import {
  attributeToRoot,
  type ProcInfo,
  parseElapsed,
  parseLsofCwds,
  parsePsAges,
  shortCommand,
  subtreeOf,
} from "./detect";

describe("parseElapsed", () => {
  it("reads every ps elapsed shape", () => {
    expect(parseElapsed("02:11")).toBe(131); // mm:ss
    expect(parseElapsed("14:02:11")).toBe(50531); // hh:mm:ss
    expect(parseElapsed("5-14:02:11")).toBe(482531); // dd-hh:mm:ss
  });

  it("tolerates padding and rejects junk", () => {
    expect(parseElapsed("   5-14:02:11 ")).toBe(482531);
    expect(parseElapsed("")).toBeNull();
    expect(parseElapsed("-")).toBeNull();
    expect(parseElapsed("Tue Sep 15")).toBeNull();
  });
});

describe("parsePsAges", () => {
  const NOW = 1_000_000_000_000;

  it("derives an absolute start time and keeps the command", () => {
    const got = parsePsAges(
      ` 36019   36003 5-14:02:11 next-server (v16.2.11)`,
      NOW,
    );
    expect(got.get(36019)).toEqual({
      ppid: 36003,
      startedAt: NOW - 482531 * 1000,
      command: "next-server (v16.2.11)",
    });
  });

  it("skips lines it cannot read rather than inventing an age", () => {
    const got = parsePsAges(
      ["", "garbage", "1 2 notatime cmd"].join("\n"),
      NOW,
    );
    expect(got.size).toBe(0);
  });
});

describe("subtreeOf", () => {
  const table = new Map<number, ProcInfo>([
    [1, { ppid: 0, startedAt: 0, command: "init" }],
    [10, { ppid: 1, startedAt: 0, command: "airlock" }],
    [11, { ppid: 10, startedAt: 0, command: "helper" }],
    [12, { ppid: 11, startedAt: 0, command: "grandchild" }],
    [20, { ppid: 1, startedAt: 0, command: "unrelated" }],
  ]);

  it("collects descendants at any depth", () => {
    expect([...subtreeOf(table, 10)].sort((a, b) => a - b)).toEqual([
      10, 11, 12,
    ]);
  });

  it("terminates on a cycle instead of hanging main", () => {
    const cyclic = new Map<number, ProcInfo>([
      [1, { ppid: 2, startedAt: 0, command: "a" }],
      [2, { ppid: 1, startedAt: 0, command: "b" }],
    ]);
    expect(subtreeOf(cyclic, 1).has(2)).toBe(true);
  });
});

describe("parseLsofCwds", () => {
  it("pairs each process block with its path", () => {
    const raw = ["p36019", "n/Users/r/Projects/ElArqui", "p40", "n/tmp"].join(
      "\n",
    );
    expect(parseLsofCwds(raw)).toEqual(
      new Map([
        [36019, "/Users/r/Projects/ElArqui"],
        [40, "/tmp"],
      ]),
    );
  });

  it("ignores a process block with no path", () => {
    expect(parseLsofCwds("p1\np2\nn/only/two").get(1)).toBeUndefined();
  });
});

describe("attributeToRoot", () => {
  const roots = ["/p/app", "/p/app/packages/inner", "/p/other"];

  it("attributes a directory to its project", () => {
    expect(attributeToRoot("/p/app", roots)).toBe("/p/app");
    expect(attributeToRoot("/p/app/src/x", roots)).toBe("/p/app");
  });

  it("prefers the innermost project when they nest", () => {
    expect(attributeToRoot("/p/app/packages/inner/src", roots)).toBe(
      "/p/app/packages/inner",
    );
  });

  it("never attributes a prefix-sharing sibling", () => {
    // The trap the container scoping hit: /p/app-old is not inside /p/app.
    expect(attributeToRoot("/p/app-old/src", roots)).toBeNull();
  });

  it("returns null for anything outside the projects", () => {
    expect(attributeToRoot("/usr/local/var", roots)).toBeNull();
    expect(attributeToRoot("/", roots)).toBeNull();
  });
});

describe("shortCommand", () => {
  it("reduces an absolute binary path to its basename", () => {
    expect(
      shortCommand("/Users/r/.nvm/versions/node/v24/bin/node app.js"),
    ).toBe("node app.js");
  });

  it("truncates a long command rather than letting it run off the card", () => {
    const got = shortCommand(`node ${"x".repeat(200)}`, 20);
    expect(got).toHaveLength(20);
    expect(got.endsWith("...")).toBe(true);
  });
});
