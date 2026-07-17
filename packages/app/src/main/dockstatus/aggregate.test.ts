import { describe, expect, it } from "vitest";
import {
  aggregateDockState,
  parseSessionLine,
  WORKING_STALE_SECONDS,
} from "./aggregate";

describe("parseSessionLine", () => {
  it("parses working/done with a timestamp", () => {
    expect(parseSessionLine("working 100")).toEqual({
      state: "working",
      ts: 100,
    });
    expect(parseSessionLine("done 50")).toEqual({ state: "done", ts: 50 });
  });
  it("returns null on garbage / partial / empty", () => {
    expect(parseSessionLine("garbage")).toBeNull();
    expect(parseSessionLine("working")).toBeNull();
    expect(parseSessionLine("")).toBeNull();
    expect(parseSessionLine("busy 10")).toBeNull();
  });
});

describe("aggregateDockState", () => {
  const now = 10_000;
  it("is idle with no sessions", () => {
    expect(aggregateDockState([], 0, now)).toBe("idle");
  });
  it("is working when any session is working within the horizon", () => {
    expect(aggregateDockState([{ state: "working", ts: now }], 0, now)).toBe(
      "working",
    );
  });
  it("ignores a stale working (interrupt safety net)", () => {
    const stale = now - WORKING_STALE_SECONDS - 1;
    expect(aggregateDockState([{ state: "working", ts: stale }], 0, now)).toBe(
      "idle",
    );
  });
  it("is done when a done is newer than the last focus ack", () => {
    expect(aggregateDockState([{ state: "done", ts: 100 }], 50, now)).toBe(
      "done",
    );
  });
  it("is idle when the done was already acknowledged (older than ack)", () => {
    expect(aggregateDockState([{ state: "done", ts: 50 }], 100, now)).toBe(
      "idle",
    );
  });
  it("working wins over done", () => {
    expect(
      aggregateDockState(
        [
          { state: "done", ts: now },
          { state: "working", ts: now },
        ],
        0,
        now,
      ),
    ).toBe("working");
  });
});
