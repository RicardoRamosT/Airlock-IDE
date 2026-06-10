import { describe, expect, it } from "vitest";
import type { SessionUsage } from "../../shared/ipc";
import {
  mergeQuota,
  parseQuota,
  parseSessionMeta,
  parseSessionUsage,
  recordUsage,
} from "./parse";

describe("parseSessionUsage", () => {
  // Claude Code >= 2.1.132: context_window.total_* is the CURRENT context
  // (occupancy from the most recent API response), NOT cumulative session
  // totals. The cumulative session metrics live under `cost`.
  const PAYLOAD = JSON.stringify({
    session_id: "abc",
    cwd: "/Users/r/Projects/lendlogic",
    model: { id: "claude-fable-5", display_name: "Fable 5" },
    cost: {
      total_cost_usd: 1.25,
      total_duration_ms: 90_000,
      total_api_duration_ms: 30_000,
      total_lines_added: 10,
      total_lines_removed: 3,
    },
    context_window: {
      total_input_tokens: 50_000,
      total_output_tokens: 2_000,
      context_window_size: 200_000,
      current_usage: {
        cache_read_input_tokens: 40_000,
        cache_creation_input_tokens: 5_000,
      },
    },
  });

  it("extracts a full snapshot (context as occupancy, cost as cumulative)", () => {
    expect(parseSessionUsage(PAYLOAD, 123)).toEqual({
      sessionId: "abc",
      cwd: "/Users/r/Projects/lendlogic",
      model: "Fable 5",
      contextTokens: 50_000,
      contextWindowSize: 200_000,
      costUsd: 1.25,
      apiMs: 30_000,
      linesAdded: 10,
      linesRemoved: 3,
      lastEmitAt: 123,
    });
  });

  it("zeros missing cost/context_window and tolerates garbage", () => {
    const u = parseSessionUsage(JSON.stringify({ session_id: "x" }), 5);
    expect(u).toMatchObject({
      sessionId: "x",
      contextTokens: 0,
      contextWindowSize: 0,
      costUsd: 0,
      model: null,
      cwd: null,
    });
    expect(parseSessionUsage("not json", 5)).toBeNull();
    expect(parseSessionUsage(JSON.stringify({ no_session: 1 }), 5)).toBeNull();
  });
});

describe("recordUsage", () => {
  const mkU = (id: string, emitAt: number) =>
    parseSessionUsage(JSON.stringify({ session_id: id }), emitAt);
  it("keeps the latest snapshot per session and evicts the oldest at cap", () => {
    const m = new Map<string, SessionUsage>();
    const a1 = mkU("a", 1);
    const a2 = mkU("a", 9);
    if (!a1 || !a2) throw new Error("fixture");
    recordUsage(m, a1, 2);
    recordUsage(m, a2, 2);
    expect(m.get("a")?.lastEmitAt).toBe(9); // latest wins, no dup entry
    const b = mkU("b", 5);
    const c = mkU("c", 6);
    if (!b || !c) throw new Error("fixture");
    recordUsage(m, b, 2);
    recordUsage(m, c, 2); // cap 2: a=9, b=5, c=6 -> evict b (oldest emit)
    expect([...m.keys()].sort()).toEqual(["a", "c"]);
  });
});

it("parseSessionMeta extracts session_id and transcript_path", () => {
  const text = JSON.stringify({
    session_id: "abc",
    transcript_path: "/p/abc.jsonl",
    rate_limits: {},
  });
  expect(parseSessionMeta(text)).toEqual({
    sessionId: "abc",
    transcriptPath: "/p/abc.jsonl",
  });
});

it("parseSessionMeta tolerates missing fields and garbage", () => {
  expect(parseSessionMeta("garbage")).toEqual({
    sessionId: null,
    transcriptPath: null,
  });
  expect(parseSessionMeta("{}")).toEqual({
    sessionId: null,
    transcriptPath: null,
  });
});

const NOW = 1_700_000_000;

it("parses both windows and clamps/floors values", () => {
  const text = JSON.stringify({
    rate_limits: {
      five_hour: { used_percentage: 39.4, resets_at: 1_700_004_321.9 },
      seven_day: { used_percentage: 120, resets_at: 1_700_400_000 },
    },
    model: { id: "claude-opus-4-8", display_name: "Opus 4.8" },
  });
  const s = parseQuota(text, NOW);
  expect(s.available).toBe(true);
  expect(s.fiveHour).toEqual({ usedPercentage: 39.4, resetsAt: 1_700_004_321 });
  expect(s.sevenDay).toEqual({ usedPercentage: 100, resetsAt: 1_700_400_000 }); // clamped
  expect(s.model).toBe("Opus 4.8");
  expect(s.updatedAt).toBe(NOW);
});

it("handles only one window present", () => {
  const text = JSON.stringify({
    rate_limits: { five_hour: { used_percentage: 5, resets_at: 10 } },
  });
  const s = parseQuota(text, NOW);
  expect(s.fiveHour).toEqual({ usedPercentage: 5, resetsAt: 10 });
  expect(s.sevenDay).toBeNull();
  expect(s.available).toBe(true);
});

it("reports unavailable when rate_limits is absent", () => {
  const s = parseQuota(
    JSON.stringify({ model: "x", cost: { total_cost_usd: 1 } }),
    NOW,
  );
  expect(s).toEqual({
    fiveHour: null,
    sevenDay: null,
    model: "x",
    updatedAt: NOW,
    available: false,
  });
});

it("reports unavailable for empty or garbage input", () => {
  expect(parseQuota("", NOW).available).toBe(false);
  expect(parseQuota("not json", NOW).available).toBe(false);
  expect(parseQuota("null", NOW).available).toBe(false);
});

it("falls back to model id when no display_name", () => {
  const text = JSON.stringify({ model: { id: "claude-x" }, rate_limits: {} });
  expect(parseQuota(text, NOW).model).toBe("claude-x");
});

const good: ReturnType<typeof parseQuota> = {
  fiveHour: { usedPercentage: 47, resetsAt: 1_700_006_480 },
  sevenDay: { usedPercentage: 58, resetsAt: 1_700_400_000 },
  model: "Opus 4.8",
  updatedAt: NOW,
  available: true,
};

it("mergeQuota returns next verbatim when there is no prior", () => {
  expect(mergeQuota(null, good)).toEqual(good);
});

it("mergeQuota carries last-known windows forward when a new emit has none", () => {
  // A fresh session's first statusLine render: rate_limits absent.
  const blank = parseQuota(JSON.stringify({ model: "Opus 4.8" }), NOW + 5);
  expect(blank.available).toBe(false);
  const merged = mergeQuota(good, blank);
  expect(merged.available).toBe(true); // NOT clobbered to unavailable
  expect(merged.fiveHour).toEqual(good.fiveHour);
  expect(merged.sevenDay).toEqual(good.sevenDay);
  expect(merged.updatedAt).toBe(NOW + 5); // an emit did happen
});

it("mergeQuota prefers fresh windows when the new emit has them", () => {
  const fresh = {
    ...good,
    fiveHour: { usedPercentage: 51, resetsAt: 1_700_006_480 },
    updatedAt: NOW + 10,
  };
  const merged = mergeQuota(good, fresh);
  expect(merged.fiveHour?.usedPercentage).toBe(51); // new value wins
  expect(merged.sevenDay).toEqual(good.sevenDay);
});

it("mergeQuota fills only the missing window independently", () => {
  const onlySeven = parseQuota(
    JSON.stringify({
      rate_limits: {
        seven_day: { used_percentage: 60, resets_at: 1_700_400_000 },
      },
    }),
    NOW + 10,
  );
  const merged = mergeQuota(good, onlySeven);
  expect(merged.fiveHour).toEqual(good.fiveHour); // carried forward
  expect(merged.sevenDay?.usedPercentage).toBe(60); // updated
});
