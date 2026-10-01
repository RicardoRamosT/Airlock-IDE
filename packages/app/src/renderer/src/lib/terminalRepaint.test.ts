import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { forceRepaint, REPAINT_NUDGE_MS } from "./terminalRepaint";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("narrows by one column, then restores after a delay (never back-to-back)", () => {
  const calls: [number, number][] = [];
  forceRepaint(
    (c, r) => calls.push([c, r]),
    () => ({ cols: 80, rows: 24 }),
  );
  // Only the nudge so far: a restore in the same tick would coalesce into no
  // SIGWINCH at all, which is the whole bug.
  expect(calls).toEqual([[79, 24]]);
  vi.advanceTimersByTime(REPAINT_NUDGE_MS);
  expect(calls).toEqual([
    [79, 24],
    [80, 24],
  ]);
});

it("restores to the size CURRENT at restore time, not the size at nudge time", () => {
  const calls: [number, number][] = [];
  let size = { cols: 80, rows: 24 };
  forceRepaint(
    (c, r) => calls.push([c, r]),
    () => size,
  );
  size = { cols: 100, rows: 30 }; // a refit landed in between
  vi.advanceTimersByTime(REPAINT_NUDGE_MS);
  expect(calls.at(-1)).toEqual([100, 30]);
});

it("disposing mid-nudge restores at once and never restores twice", () => {
  const calls: [number, number][] = [];
  const dispose = forceRepaint(
    (c, r) => calls.push([c, r]),
    () => ({ cols: 80, rows: 24 }),
  );
  dispose();
  expect(calls).toEqual([
    [79, 24],
    [80, 24],
  ]);
  vi.advanceTimersByTime(REPAINT_NUDGE_MS * 2);
  dispose();
  expect(calls).toHaveLength(2);
});

it("a one-column terminal is only resized, never narrowed to zero", () => {
  const calls: [number, number][] = [];
  forceRepaint(
    (c, r) => calls.push([c, r]),
    () => ({ cols: 1, rows: 24 }),
  );
  vi.advanceTimersByTime(REPAINT_NUDGE_MS);
  expect(calls).toEqual([[1, 24]]);
});
