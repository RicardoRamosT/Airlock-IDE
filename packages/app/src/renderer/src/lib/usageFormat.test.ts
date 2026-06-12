import { describe, expect, it } from "vitest";
import type { SessionUsage } from "../../../shared/ipc";
import {
  aggregateByModel,
  formatApiTime,
  formatModels,
  formatTokens,
  formatUsd,
  isSessionActive,
  sessionDidWork,
  visibleSessions,
} from "./usageFormat";

const mk = (over: Partial<SessionUsage>): SessionUsage => ({
  sessionId: "s",
  cwd: null,
  model: null,
  modelsSeen: [],
  contextTokens: 0,
  contextWindowSize: 0,
  costUsd: 0,
  apiMs: 0,
  linesAdded: 0,
  linesRemoved: 0,
  lastEmitAt: 0,
  lastProgressAt: 0,
  ...over,
});

describe("aggregateByModel", () => {
  // Only the CUMULATIVE session metrics aggregate (cost / API time / sessions);
  // context occupancy is point-in-time and summing it is meaningless. Sorted by
  // API time -- the "which model worked more" ordering that still ranks on
  // subscription plans where reported USD is zero.
  it("groups, sums cumulative metrics, and sorts by API time", () => {
    const rows = aggregateByModel([
      mk({ sessionId: "a", model: "Fable 5", apiMs: 10_000, costUsd: 1 }),
      mk({ sessionId: "b", model: "Fable 5", apiMs: 5_000, costUsd: 0.5 }),
      mk({ sessionId: "c", model: "Opus 4.8", apiMs: 100_000 }),
      mk({ sessionId: "d", model: null, apiMs: 1_000 }),
    ]);
    expect(rows.map((r) => r.model)).toEqual([
      "Opus 4.8",
      "Fable 5",
      "unknown",
    ]);
    expect(rows[1]).toMatchObject({
      sessions: 2,
      apiMs: 15_000,
      costUsd: 1.5,
    });
  });

  it("counts a multi-model session under EVERY model it used, cost on the primary", () => {
    // One session that switched Fable -> Opus: the statusLine can't split its
    // single cumulative cost, so cost/API book to the latest (primary) model
    // while both models are counted. Surfaces Fable instead of hiding it.
    const rows = aggregateByModel([
      mk({
        sessionId: "a",
        model: "Opus 4.8",
        modelsSeen: ["Fable 5", "Opus 4.8"],
        apiMs: 100_000,
        costUsd: 5,
      }),
    ]);
    const opus = rows.find((r) => r.model === "Opus 4.8");
    const fable = rows.find((r) => r.model === "Fable 5");
    expect(opus).toMatchObject({ sessions: 1, apiMs: 100_000, costUsd: 5 });
    // Fable is counted, but its cost is the unattributable remainder: 0 here.
    expect(fable).toMatchObject({ sessions: 1, apiMs: 0, costUsd: 0 });
  });
});

describe("session liveness + visibility", () => {
  it("sessionDidWork is true only with real work, not context occupancy alone", () => {
    expect(sessionDidWork(mk({ apiMs: 1 }))).toBe(true);
    expect(sessionDidWork(mk({ costUsd: 0.5 }))).toBe(true);
    expect(sessionDidWork(mk({ linesAdded: 2 }))).toBe(true);
    // A forked/background session that only loaded context (170k) but never did
    // a billable turn -- the "ricardoramos ghost" -- is NOT work.
    expect(sessionDidWork(mk({ contextTokens: 170_000 }))).toBe(false);
    expect(sessionDidWork(mk({}))).toBe(false);
  });

  it("visibleSessions drops context-only ghosts and idle blanks", () => {
    const worker = mk({ sessionId: "w", apiMs: 5_000 });
    const ghost = mk({ sessionId: "g", contextTokens: 170_000 });
    const blank = mk({ sessionId: "b" });
    expect(visibleSessions([worker, ghost, blank])).toEqual([worker]);
  });

  it("isSessionActive keys off lastProgressAt, not the refresh-timer emit", () => {
    const now = 1000;
    // Working now: advanced within the window.
    expect(isSessionActive(mk({ lastProgressAt: now - 5 }), now)).toBe(true);
    // Open but idle: still emitting (lastEmitAt fresh) yet no recent progress.
    expect(
      isSessionActive(mk({ lastEmitAt: now, lastProgressAt: now - 300 }), now),
    ).toBe(false);
  });
});

describe("formatModels", () => {
  it("joins every model a session used; unknown when none", () => {
    expect(formatModels(mk({ modelsSeen: ["Opus 4.8"] }))).toBe("Opus 4.8");
    expect(formatModels(mk({ modelsSeen: ["Fable 5", "Opus 4.8"] }))).toBe(
      "Fable 5, Opus 4.8",
    );
    expect(formatModels(mk({ modelsSeen: [], model: null }))).toBe("unknown");
  });
});

describe("formatters", () => {
  it("formatTokens scales units", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(12_340)).toBe("12.3k");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });
  it("formatApiTime renders s / m s", () => {
    expect(formatApiTime(0)).toBe("0s");
    expect(formatApiTime(12_000)).toBe("12s");
    expect(formatApiTime(272_000)).toBe("4m 32s");
  });
  it("formatUsd shows dashes for zero and cents otherwise", () => {
    expect(formatUsd(0)).toBe("—");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(1.25)).toBe("$1.25");
  });
});
