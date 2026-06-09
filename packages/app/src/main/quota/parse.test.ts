import { expect, it } from "vitest";
import { parseQuota } from "./parse";

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
