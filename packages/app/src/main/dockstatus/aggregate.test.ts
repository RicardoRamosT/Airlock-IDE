import { describe, expect, it } from "vitest";
import {
  aggregateDockState,
  LIVENESS_STALE_SECONDS,
  parseLivenessLine,
  parseSessionLine,
  type SessionEntry,
  TRANSCRIPT_SILENT_SECONDS,
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
    // A session that is genuinely working has a transcript that is growing;
    // that is the whole basis of TRANSCRIPT_SILENT_SECONDS.
    transcriptTs: now,
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
        [
          {
            phase: "done",
            phaseTs: now - 600,
            liveTs: now,
            transcriptTs: null,
          },
        ],
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
        [{ phase: "done", phaseTs: 100, liveTs: null, transcriptTs: null }],
        50,
        now,
      ),
    ).toBe("done");
  });
  it("is idle when the done was already acknowledged (older than ack)", () => {
    expect(
      aggregateDockState(
        [{ phase: "done", phaseTs: 50, liveTs: null, transcriptTs: null }],
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
          { phase: "done", phaseTs: now, liveTs: now, transcriptTs: null }, // one just finished
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
          { phase: "done", phaseTs: now, liveTs: now, transcriptTs: null },
          { phase: "done", phaseTs: now, liveTs: now, transcriptTs: null },
        ],
        0,
        now,
      ),
    ).toBe("done");
  });
});

describe("an interrupted turn", () => {
  // NOTHING fires when a turn is interrupted with Escape. Observed in a real
  // session on 2026-09-13: an interrupt at 00:20:14, the next user message at
  // 01:36:23, and not one hook record in between -- no Stop, no idle_prompt.
  // So PHASE stays "working" forever, and the heartbeat only ever proves the
  // PROCESS is alive, not that a TURN is running. Those two were treated as
  // the same thing, which is why the dot stuck yellow for 76 minutes.
  //
  // The transcript is the signal that does not depend on a hook: it grows
  // while work happens and goes silent the instant it stops. Measured over
  // 1278 gaps in that session: median 1s, p90 13s, p95 24s, p99 99s.
  const base = { phase: "working" as const, phaseTs: 1000, liveTs: 1000 };

  it("stops counting as work once the transcript has gone quiet", () => {
    const now = 1000 + TRANSCRIPT_SILENT_SECONDS + 1;
    expect(
      aggregateDockState(
        [{ ...base, liveTs: now, transcriptTs: 1000 }],
        0,
        now,
      ),
    ).not.toBe("working");
  });

  it("still counts as work while the transcript is growing", () => {
    // A long think or a subagent wait: no hook fires for minutes, but records
    // keep landing. This is the false-grey the 2026-07-29 fix was about, and
    // it must not come back.
    const now = 1000 + 600;
    expect(
      aggregateDockState(
        [
          {
            phase: "working",
            phaseTs: 1000,
            liveTs: now,
            transcriptTs: now - 20,
          },
        ],
        0,
        now,
      ),
    ).toBe("working");
  });

  it("is not rescued by the heartbeat alone", () => {
    // The heartbeat keeps firing every 5s for as long as the terminal is open.
    const now = 1000 + 86_400;
    expect(
      aggregateDockState(
        [{ ...base, liveTs: now, transcriptTs: 1000 }],
        0,
        now,
      ),
    ).not.toBe("working");
  });

  it("falls back to the phase clock when there is no transcript", () => {
    // Quota meter off, or the transcript could not be located: behave exactly
    // as before rather than inventing a verdict.
    const now = 1000 + 20;
    expect(
      aggregateDockState(
        [{ phase: "working", phaseTs: 1000, liveTs: now, transcriptTs: null }],
        0,
        now,
      ),
    ).toBe("working");
  });
});
