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

it("rejects a whole emit that carries any expired window (stale resumed-session snapshot)", () => {
  const t = new QuotaTracker(120, 20);
  t.record(
    "fresh",
    {
      fiveHour: { usedPercentage: 87, resetsAt: 2000 },
      sevenDay: { usedPercentage: 16, resetsAt: 9000 },
      model: "m",
      updatedAt: 1000,
      available: true,
    },
    1000,
  );
  // Seen live (2026-06-10): a resumed/forked Claude session re-emits a
  // transcript-vintage rate_limits snapshot until its first own turn
  // completes. Its 5h window is already EXPIRED at emit time -- proof the
  // whole payload is old -- but its 7d shares the live week's resetsAt, so
  // folding it (max within window) would latch the stale 49 until the week
  // ends. Trust nothing from an emit with any expired window.
  const out = t.record(
    "stale-fork",
    {
      fiveHour: { usedPercentage: 5, resetsAt: 500 },
      sevenDay: { usedPercentage: 49, resetsAt: 9000 },
      model: "m",
      updatedAt: 1005,
      available: true,
    },
    1005,
  );
  expect(out?.fiveHour?.usedPercentage).toBe(87);
  expect(out?.sevenDay?.usedPercentage).toBe(16); // NOT poisoned to 49
});

it("still counts a stale-snapshot emitter for liveness (waiting, not blank, when alone)", () => {
  const t = new QuotaTracker(120, 20);
  const out = t.record(
    "stale-fork",
    {
      fiveHour: { usedPercentage: 5, resetsAt: 500 }, // expired at emit 1000
      sevenDay: { usedPercentage: 49, resetsAt: 9000 },
      model: "m",
      updatedAt: 1000,
      available: true,
    },
    1000,
  );
  expect(out).not.toBeNull(); // a session IS emitting...
  expect(out?.available).toBe(false); // ...but no trustworthy windows yet
});

it("hides a folded window once its reset passes (no finished bar / negative countdown)", () => {
  const t = new QuotaTracker(120, 20);
  t.record("s", mk(80, 1000, 1015), 1000); // resets 15s after the emit
  const out = t.current(1018); // session still live; the boundary has passed
  expect(out).not.toBeNull();
  expect(out?.fiveHour).toBeNull();
  expect(out?.sevenDay).toBeNull();
  expect(out?.available).toBe(false);
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
