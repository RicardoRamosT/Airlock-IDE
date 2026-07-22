import { describe, expect, it } from "vitest";
import {
  aggregateDockState,
  LIVENESS_STALE_SECONDS,
  parseLivenessLine,
  parseSessionLine,
  type SessionEntry,
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

describe("parseLivenessLine", () => {
  it("parses a bare epoch", () => {
    expect(parseLivenessLine("1784700000")).toBe(1784700000);
    expect(parseLivenessLine("  42\n")).toBe(42);
  });
  it("returns null on garbage / empty / a phase line", () => {
    expect(parseLivenessLine("nope")).toBeNull();
    expect(parseLivenessLine("")).toBeNull();
    expect(parseLivenessLine("working 100")).toBeNull();
    expect(parseLivenessLine("0")).toBeNull();
  });
});

describe("aggregateDockState", () => {
  const now = 10_000;
  const w = (over: Partial<SessionEntry> = {}): SessionEntry => ({
    phase: "working",
    phaseTs: now,
    liveTs: null,
    ...over,
  });

  it("is idle with no sessions", () => {
    expect(aggregateDockState([], 0, now)).toBe("idle");
  });

  // --- liveness present (quota statusLine on) ---
  it("stays working on a fresh heartbeat even when the phase stamp is ancient (thinking / subagent wait)", () => {
    // phaseTs is way past the legacy 45s window, but the live heartbeat holds it.
    expect(
      aggregateDockState([w({ phaseTs: now - 600, liveTs: now - 3 })], 0, now),
    ).toBe("working");
  });
  it("clears when the heartbeat goes stale (session died mid-work)", () => {
    const stale = now - LIVENESS_STALE_SECONDS - 1;
    expect(
      aggregateDockState([w({ phaseTs: now - 600, liveTs: stale })], 0, now),
    ).toBe("idle");
  });
  it("a fresh heartbeat on a DONE phase never shows working (an idle session still pings)", () => {
    expect(
      aggregateDockState(
        [{ phase: "done", phaseTs: now - 600, liveTs: now }],
        now - 700, // the done is newer than the ack -> surfaces as done, not working
        now,
      ),
    ).toBe("done");
  });

  // --- liveness absent (quota meter off) -> legacy 45s fallback ---
  it("legacy fallback: working within the phase horizon when there is no heartbeat", () => {
    expect(
      aggregateDockState([w({ liveTs: null, phaseTs: now })], 0, now),
    ).toBe("working");
  });
  it("legacy fallback: a stale working clears (interrupt safety net) when there is no heartbeat", () => {
    const stale = now - WORKING_STALE_SECONDS - 1;
    expect(
      aggregateDockState([w({ liveTs: null, phaseTs: stale })], 0, now),
    ).toBe("idle");
  });

  // --- done / focus ack ---
  it("is done when a done is newer than the last focus ack", () => {
    expect(
      aggregateDockState(
        [{ phase: "done", phaseTs: 100, liveTs: null }],
        50,
        now,
      ),
    ).toBe("done");
  });
  it("is idle when the done was already acknowledged (older than ack)", () => {
    expect(
      aggregateDockState(
        [{ phase: "done", phaseTs: 50, liveTs: null }],
        100,
        now,
      ),
    ).toBe("idle");
  });

  // --- multiple concurrent Claudes: yellow until ALL have finished ---
  it("stays working while ONE of several sessions is still working (the multi-Claude green bug)", () => {
    expect(
      aggregateDockState(
        [
          { phase: "done", phaseTs: now, liveTs: now }, // one just finished
          w({ phaseTs: now - 300, liveTs: now - 2 }), // another still thinking
        ],
        0,
        now,
      ),
    ).toBe("working");
  });
  it("turns done only once EVERY session has finished", () => {
    expect(
      aggregateDockState(
        [
          { phase: "done", phaseTs: now, liveTs: now },
          { phase: "done", phaseTs: now, liveTs: now },
        ],
        0,
        now,
      ),
    ).toBe("done");
  });
});
