import { describe, expect, it } from "vitest";
import type { LogEvent } from "./types";
import { EventWriter } from "./writer";

function mk(op: string): Omit<LogEvent, "seq"> {
  return {
    ts: "2026-01-01T00:00:00.000Z",
    level: "info",
    category: "test",
    op,
  };
}

describe("EventWriter", () => {
  it("assigns increasing seq and flushes the batch in order", async () => {
    const got: LogEvent[][] = [];
    const w = new EventWriter(async (b) => void got.push(b), {
      capacity: 100,
      flushThreshold: 100,
    });
    w.emit(mk("a"));
    w.emit(mk("b"));
    await w.flush();
    expect(got).toHaveLength(1);
    expect(got[0]?.map((e) => [e.op, e.seq])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });

  it("auto-flushes when the buffer reaches the threshold", async () => {
    const got: LogEvent[][] = [];
    const w = new EventWriter(async (b) => void got.push(b), {
      capacity: 100,
      flushThreshold: 2,
    });
    w.emit(mk("a"));
    w.emit(mk("b")); // hits threshold -> triggers flush
    await Promise.resolve(); // let the chained flush settle
    await w.flush();
    expect(got.flat().map((e) => e.op)).toEqual(["a", "b"]);
  });

  it("drops oldest beyond capacity and reports the dropped count", async () => {
    const got: LogEvent[][] = [];
    const w = new EventWriter(async (b) => void got.push(b), {
      capacity: 2,
      flushThreshold: 100,
    });
    w.emit(mk("a"));
    w.emit(mk("b"));
    w.emit(mk("c")); // capacity 2 -> "a" dropped
    expect(w.takeDropped()).toBe(1);
    expect(w.takeDropped()).toBe(0); // takeDropped resets
    await w.flush();
    expect(got.flat().map((e) => e.op)).toEqual(["b", "c"]);
  });

  it("a flush with an empty buffer is a no-op (sink not called)", async () => {
    let calls = 0;
    const w = new EventWriter(async () => void calls++, {
      capacity: 10,
      flushThreshold: 10,
    });
    await w.flush();
    expect(calls).toBe(0);
  });

  it("never rejects when the sink throws", async () => {
    const w = new EventWriter(
      async () => {
        throw new Error("disk full");
      },
      { capacity: 10, flushThreshold: 10 },
    );
    w.emit(mk("a"));
    await expect(w.flush()).resolves.toBeUndefined();
  });
});
