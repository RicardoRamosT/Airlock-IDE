import { describe, expect, it } from "vitest";
import type { QuotaWindow } from "../../../shared/ipc";
import {
  clampPct,
  formatCountdown,
  isWindowAwaiting,
  QUOTA_RED_AT,
  QUOTA_YELLOW_AT,
  quotaFillColor,
  quotaFillHue,
  wingCountdown,
} from "./quotaFormat";

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

describe("quotaFillColor", () => {
  it("lands exactly on yellow at 75% and red at 90% (the meaningful levels)", () => {
    expect(quotaFillHue(QUOTA_YELLOW_AT)).toBe(42); // orange-leaning yellow
    expect(quotaFillHue(QUOTA_RED_AT)).toBe(2); // red
  });

  it("holds red above 90% instead of drifting past it", () => {
    expect(quotaFillHue(95)).toBe(quotaFillHue(QUOTA_RED_AT));
    expect(quotaFillHue(100)).toBe(quotaFillHue(QUOTA_RED_AT));
  });

  it("warms monotonically -- never doubles back", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let p = 0; p <= 100; p += 5) {
      const hue = quotaFillHue(p);
      expect(hue).toBeLessThanOrEqual(prev);
      prev = hue;
    }
  });

  it("still reads BLUE through light usage (the eased first leg)", () => {
    expect(quotaFillHue(0)).toBe(212);
    // Without easing, 15% would already have drifted to cyan/teal.
    expect(quotaFillHue(15)).toBeGreaterThan(190);
  });

  it("keeps lightness mid-range so white text stays legible over the fill", () => {
    for (let p = 0; p <= 100; p += 5) {
      const l = Number(/(\d+)%\)$/.exec(quotaFillColor(p))?.[1]);
      expect(l).toBeLessThanOrEqual(62);
      expect(l).toBeGreaterThanOrEqual(45);
    }
  });

  it("clamps nonsense input instead of emitting a broken colour", () => {
    expect(quotaFillHue(-40)).toBe(quotaFillHue(0));
    expect(quotaFillHue(Number.NaN)).toBe(quotaFillHue(0));
    expect(quotaFillColor(50)).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
  });
});

describe("wingCountdown", () => {
  it("is the short countdown for a running window", () => {
    expect(wingCountdown({ resetsAt: 1000 + 3 * 3600 + 780 }, 1000)).toBe(
      "3h13m",
    );
  });
  it("reads idle for a window that has not started", () => {
    expect(wingCountdown({ resetsAt: 9999, awaitingNextWindow: true }, 1)).toBe(
      "idle",
    );
    // Boundary passed by the UI's own clock, before the next emit re-flags it.
    expect(wingCountdown({ resetsAt: 500 }, 900)).toBe("idle");
  });
  it("is empty when there is no window, so no stray dash is drawn", () => {
    expect(wingCountdown(null, 1000)).toBe("");
  });
});
