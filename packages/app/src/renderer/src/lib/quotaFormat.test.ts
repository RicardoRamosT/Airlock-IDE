import { expect, it } from "vitest";
import type { QuotaWindow } from "../../../shared/ipc";
import { clampPct, formatCountdown, isWindowAwaiting } from "./quotaFormat";

const win = (over: Partial<QuotaWindow> = {}): QuotaWindow => ({
  usedPercentage: 50,
  resetsAt: 9_999_999_999,
  ...over,
});

it("formats countdowns compactly", () => {
  expect(formatCountdown(0)).toBe("now");
  expect(formatCountdown(-10)).toBe("now");
  expect(formatCountdown(30)).toBe("<1m");
  expect(formatCountdown(90)).toBe("1m");
  expect(formatCountdown(4350)).toBe("1h12m"); // 1h 12m 30s
  expect(formatCountdown(90000)).toBe("1d 1h"); // 25h
});

it("treats a window as awaiting once its reset boundary has passed", () => {
  const now = 1000;
  // Still counting down -- a normal live window.
  expect(isWindowAwaiting(win({ resetsAt: now + 30 }), now)).toBe(false);
  // The tracker already flagged it awaiting (its synthesized 0% row).
  expect(
    isWindowAwaiting(win({ resetsAt: 500, awaitingNextWindow: true }), now),
  ).toBe(true);
  // Boundary just passed but no fresh emit re-flagged it yet: the UI must NOT
  // render "now" (the old "session now" glitch) -- it's awaiting the next use.
  expect(isWindowAwaiting(win({ resetsAt: now }), now)).toBe(true);
  expect(isWindowAwaiting(win({ resetsAt: now - 1 }), now)).toBe(true);
});

it("clamps percentages into 0..100", () => {
  expect(clampPct(-5)).toBe(0);
  expect(clampPct(150)).toBe(100);
  expect(clampPct(42)).toBe(42);
  expect(clampPct(Number.NaN)).toBe(0);
});
