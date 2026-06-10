import { describe, expect, it } from "vitest";
import type { SessionUsage } from "../../../shared/ipc";
import {
  aggregateByModel,
  formatApiTime,
  formatTokens,
  formatUsd,
} from "./usageFormat";

const mk = (over: Partial<SessionUsage>): SessionUsage => ({
  sessionId: "s",
  cwd: null,
  model: null,
  contextTokens: 0,
  contextWindowSize: 0,
  costUsd: 0,
  apiMs: 0,
  linesAdded: 0,
  linesRemoved: 0,
  lastEmitAt: 0,
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
