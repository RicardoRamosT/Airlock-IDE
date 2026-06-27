import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileSink } from "./fileSink";
import type { LogEvent } from "./types";

let dir = "";
function ev(op: string): LogEvent {
  return {
    ts: "2026-01-01T00:00:00.000Z",
    seq: 0,
    level: "info",
    category: "t",
    op,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "evt-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("createFileSink", () => {
  it("appends one JSON line per event", async () => {
    const file = path.join(dir, "log.jsonl");
    const sink = createFileSink(file, { maxBytes: 1_000_000, keepFiles: 3 });
    await sink([ev("a"), ev("b")]);
    await sink([ev("c")]);
    const lines = (await readFile(file, "utf8")).trim().split("\n");
    expect(lines.map((l) => JSON.parse(l).op)).toEqual(["a", "b", "c"]);
  });

  it("rotates when the active file would exceed maxBytes, keeping the last N", async () => {
    const file = path.join(dir, "log.jsonl");
    // maxBytes tiny so each ~40-byte batch rotates.
    const sink = createFileSink(file, { maxBytes: 50, keepFiles: 2 });
    await sink([ev("one")]);
    await sink([ev("two")]); // active is non-empty + would exceed -> rotate
    await sink([ev("three")]);
    const names = (await readdir(dir)).sort();
    // active log.jsonl plus rotations log.1.jsonl (keepFiles=2 => active + 1)
    expect(names).toContain("log.jsonl");
    expect(names).toContain("log.1.jsonl");
    expect(names).not.toContain("log.2.jsonl"); // capped
    // newest event is in the active file
    expect(await readFile(file, "utf8")).toContain("three");
  });
});
