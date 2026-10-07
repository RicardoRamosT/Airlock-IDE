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
  t.record("active", mk(62, 1000), 1000, null);
  // Idle session re-emits an OLD snapshot a moment later: account usage only
  // climbs within a window, so 62 stays the truth (no flicker back to 5).
  const out = t.record("idle", mk(5, 1005), 1005, null);
  expect(out?.fiveHour?.usedPercentage).toBe(62);
});

it("an ended session's higher reading persists while others keep emitting", () => {
  const t = new QuotaTracker(120, 20);
  t.record("ended", mk(32, 1000), 1000, null); // reports 32%, then closes
  // 60s later only an idle session (stale 31% snapshot) is still emitting.
  // The meter must NOT drop to 31 -- the window's best-known value is 32.
  const out = t.record("idle", mk(31, 1060), 1060, null);
  expect(out?.fiveHour?.usedPercentage).toBe(32);
  expect(out?.updatedAt).toBe(1060); // liveness comes from the live emitter
});

it("a new rate-limit window (later resetsAt) replaces the old fold", () => {
  const t = new QuotaTracker(120, 20);
  t.record("a", mk(80, 1000, 5000), 1000, null);
  const out = t.record("b", mk(2, 1004, 23_000), 1004, null); // window rolled
  expect(out?.fiveHour?.usedPercentage).toBe(2);
});

it("goes silent (null) when no session has emitted recently", () => {
  const t = new QuotaTracker(120, 20);
  t.record("gone", mk(62, 1000), 1000, null);
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
    null,
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
    null,
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
    null,
  );
  expect(out).not.toBeNull(); // a session IS emitting...
  expect(out?.available).toBe(false); // ...but no trustworthy windows yet
});

it("shows an expired window as a zeroed awaiting row instead of hiding it", () => {
  // QA 2026-06-11: hiding the row across a window reset read as "no limit".
  // The next window starts on the user's next message (its reset time is
  // unknowable here), so the tracker synthesizes 0% + awaitingNextWindow and
  // keeps the OLD boundary as a factual ended-at stamp.
  const t = new QuotaTracker(120, 20);
  t.record("s", mk(80, 1000, 1015), 1000, null); // resets 15s after the emit
  const out = t.current(1018); // session still live; the boundary has passed
  expect(out).not.toBeNull();
  expect(out?.fiveHour).toEqual({
    usedPercentage: 0,
    resetsAt: 1015,
    awaitingNextWindow: true,
  });
  expect(out?.sevenDay).toEqual({
    usedPercentage: 0,
    resetsAt: 1015,
    awaitingNextWindow: true,
  });
  expect(out?.available).toBe(true);
});

it("carries known windows across a rate-limit-less emit (fresh session)", () => {
  const t = new QuotaTracker(120, 20);
  t.record("s", mk(62, 1000), 1000, null);
  const blank: QuotaStatus = {
    fiveHour: null,
    sevenDay: null,
    model: null,
    updatedAt: 1002,
    available: false,
  };
  const out = t.record("s2", blank, 1002, null); // pre-first-response emit
  expect(out?.available).toBe(true);
  expect(out?.fiveHour?.usedPercentage).toBe(62);
});

// --- Account switch (2026-10-07) ---------------------------------------------
// Two Claude accounts on one machine break "a later resetsAt is a newer window":
// that is only true WITHIN one account. After a switch, idle sessions still
// re-emit the OLD account's frozen snapshot, and when the old account's week
// happens to end LATER, the monotone fold pinned it: the meter read 70% of the
// old week while the logged-in account sat at 0%.

const H5 = 5 * 3600;
const weekOnly = (
  sevenDay: { usedPercentage: number; resetsAt: number },
  at: number,
): QuotaStatus => ({
  fiveHour: null,
  sevenDay,
  model: "m",
  updatedAt: at,
  available: true,
});
const fiveOnly = (
  fiveHour: { usedPercentage: number; resetsAt: number },
  at: number,
): QuotaStatus => ({
  fiveHour,
  sevenDay: null,
  model: "m",
  updatedAt: at,
  available: true,
});

it("follows the account that answered most recently, not the week that ends last", () => {
  const t = new QuotaTracker(120, 20);
  const NOW = 2_000_000;
  const oldWeek = { usedPercentage: 70, resetsAt: NOW + 260_000 };
  const newWeek = { usedPercentage: 0, resetsAt: NOW + 230_000 };
  t.record("old-idle", weekOnly(oldWeek, NOW), NOW, 5_000);
  t.record("new-active", weekOnly(newWeek, NOW + 1), NOW + 1, 100);
  // The new-account session gets an API response: its API time climbs.
  t.record("new-active", weekOnly(newWeek, NOW + 6), NOW + 6, 900);
  // The old-account session keeps re-emitting its frozen snapshot.
  const out = t.record("old-idle", weekOnly(oldWeek, NOW + 7), NOW + 7, 5_000);
  expect(out?.sevenDay).toEqual(newWeek);
});

it("switching back: the old account wins again once IT answers", () => {
  const t = new QuotaTracker(120, 20);
  const NOW = 2_000_000;
  const oldWeek = { usedPercentage: 70, resetsAt: NOW + 260_000 };
  const newWeek = { usedPercentage: 0, resetsAt: NOW + 230_000 };
  t.record("old", weekOnly(oldWeek, NOW), NOW, 5_000);
  t.record("new", weekOnly(newWeek, NOW + 1), NOW + 1, 100);
  t.record("new", weekOnly(newWeek, NOW + 6), NOW + 6, 900);
  const out = t.record(
    "old",
    weekOnly({ ...oldWeek, usedPercentage: 71 }, NOW + 12),
    NOW + 12,
    5_600,
  );
  expect(out?.sevenDay).toEqual({ ...oldWeek, usedPercentage: 71 });
});

it("a reading that CHANGED counts as fresh even when API time is unknown", () => {
  const t = new QuotaTracker(120, 20);
  const NOW = 2_000_000;
  const oldWeek = { usedPercentage: 70, resetsAt: NOW + 260_000 };
  t.record("old", weekOnly(oldWeek, NOW), NOW, null);
  t.record(
    "new",
    weekOnly({ usedPercentage: 0, resetsAt: NOW + 230_000 }, NOW + 1),
    NOW + 1,
    null,
  );
  t.record(
    "new",
    weekOnly({ usedPercentage: 1, resetsAt: NOW + 230_000 }, NOW + 6),
    NOW + 6,
    null,
  );
  const out = t.record("old", weekOnly(oldWeek, NOW + 7), NOW + 7, null);
  expect(out?.sevenDay?.usedPercentage).toBe(1);
});

it("the switched-to account's ENDED week shows as awaiting, not the other account's live week", () => {
  const t = new QuotaTracker(120, 20);
  const NOW = 2_000_000;
  const newWeek = { usedPercentage: 40, resetsAt: NOW + 100 };
  const oldWeek = { usedPercentage: 70, resetsAt: NOW + 30_000 };
  t.record("old", weekOnly(oldWeek, NOW), NOW, 5_000);
  t.record("new", weekOnly(newWeek, NOW + 1), NOW + 1, 100);
  t.record(
    "new",
    weekOnly({ ...newWeek, usedPercentage: 41 }, NOW + 6),
    NOW + 6,
    900,
  );
  // The new account's week ends; only the old idle session is still emitting.
  const out = t.record("old", weekOnly(oldWeek, NOW + 110), NOW + 110, 5_000);
  expect(out?.sevenDay).toEqual({
    usedPercentage: 0,
    resetsAt: NOW + 100,
    awaitingNextWindow: true,
  });
});

it("a next window first seen from a brand-new session still replaces the ended one", () => {
  // The watcher polls ONE shared file and misses most emits, so a new
  // session's first OBSERVED emit can already carry the next window. Its
  // production time is unobserved -- but a window that STARTED after another
  // ENDED was necessarily produced after it, so it must win.
  const t = new QuotaTracker(120, 20);
  t.record(
    "a",
    fiveOnly({ usedPercentage: 80, resetsAt: 10_000 }, 8_990),
    8_990,
    100,
  );
  t.record(
    "a",
    fiveOnly({ usedPercentage: 85, resetsAt: 10_000 }, 9_000),
    9_000,
    200,
  );
  const next = { usedPercentage: 3, resetsAt: 10_600 + H5 };
  const out = t.record("b", fiveOnly(next, 10_700), 10_700, 50);
  expect(out?.fiveHour).toEqual(next);
});
