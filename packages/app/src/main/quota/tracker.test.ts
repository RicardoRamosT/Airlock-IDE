import { expect, it } from "vitest";
import type { QuotaStatus } from "../../shared/ipc";
import { QuotaTracker } from "./tracker";

const mk = (
  pct: number,
  updatedAt: number,
  resetsAt = 9_999_999_999,
): QuotaStatus => ({
  fiveHour: { usedPercentage: pct, resetsAt },
  sevenDay: { usedPercentage: pct, resetsAt },
  model: "m",
  updatedAt,
  available: true,
});

it("shows the freshest account reading, not whichever session wrote last", () => {
  const t = new QuotaTracker(120, 20);
  t.record("active", mk(62, 1000), 1000);
  // Idle session re-emits an OLD snapshot a moment later: account usage only
  // climbs within a window, so 62 stays the truth (no flicker back to 5).
  const out = t.record("idle", mk(5, 1005), 1005);
  expect(out?.fiveHour?.usedPercentage).toBe(62);
});

it("an ended session's higher reading persists while others keep emitting", () => {
  const t = new QuotaTracker(120, 20);
  t.record("ended", mk(32, 1000), 1000); // reports 32%, then closes
  // 60s later only an idle session (stale 31% snapshot) is still emitting.
  // The meter must NOT drop to 31 -- the window's best-known value is 32.
  const out = t.record("idle", mk(31, 1060), 1060);
  expect(out?.fiveHour?.usedPercentage).toBe(32);
  expect(out?.updatedAt).toBe(1060); // liveness comes from the live emitter
});

it("a new rate-limit window (later resetsAt) replaces the old fold", () => {
  const t = new QuotaTracker(120, 20);
  t.record("a", mk(80, 1000, 5000), 1000);
  const out = t.record("b", mk(2, 1004, 23_000), 1004); // window rolled
  expect(out?.fiveHour?.usedPercentage).toBe(2);
});

it("goes silent (null) when no session has emitted recently", () => {
  const t = new QuotaTracker(120, 20);
  t.record("gone", mk(62, 1000), 1000);
  expect(t.current(1060)).toBeNull(); // 60s silence > live window
});

it("returns null when no sessions are tracked", () => {
  expect(new QuotaTracker(120, 20).current(0)).toBeNull();
});

it("carries known windows across a rate-limit-less emit (fresh session)", () => {
  const t = new QuotaTracker(120, 20);
  t.record("s", mk(62, 1000), 1000);
  const blank: QuotaStatus = {
    fiveHour: null,
    sevenDay: null,
    model: null,
    updatedAt: 1002,
    available: false,
  };
  const out = t.record("s2", blank, 1002); // pre-first-response emit
  expect(out?.available).toBe(true);
  expect(out?.fiveHour?.usedPercentage).toBe(62);
});
