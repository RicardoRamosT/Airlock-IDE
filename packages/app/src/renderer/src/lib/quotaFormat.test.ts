import { expect, it } from "vitest";
import { clampPct, formatCountdown } from "./quotaFormat";

it("formats countdowns compactly", () => {
  expect(formatCountdown(0)).toBe("now");
  expect(formatCountdown(-10)).toBe("now");
  expect(formatCountdown(30)).toBe("<1m");
  expect(formatCountdown(90)).toBe("1m");
  expect(formatCountdown(4350)).toBe("1h12m"); // 1h 12m 30s
  expect(formatCountdown(90000)).toBe("1d 1h"); // 25h
});

it("clamps percentages into 0..100", () => {
  expect(clampPct(-5)).toBe(0);
  expect(clampPct(150)).toBe(100);
  expect(clampPct(42)).toBe(42);
  expect(clampPct(Number.NaN)).toBe(0);
});
