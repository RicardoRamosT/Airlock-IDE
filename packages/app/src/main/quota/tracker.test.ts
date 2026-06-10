import { expect, it } from "vitest";
import type { QuotaStatus } from "../../shared/ipc";
import { QuotaTracker } from "./tracker";

const mk = (pct: number, updatedAt: number): QuotaStatus => ({
  fiveHour: { usedPercentage: pct, resetsAt: 9_999_999_999 },
  sevenDay: { usedPercentage: pct, resetsAt: 9_999_999_999 },
  model: "m",
  updatedAt,
  available: true,
});

it("shows the most-recently-active session, not whichever wrote last", () => {
  const t = new QuotaTracker(120);
  // Active session: recent transcript activity (high activeAt).
  t.record("active", mk(62, 1000), 9000, 1000);
  // Idle session writes LATER (higher emitAt, via refreshInterval) but was last
  // active long ago (low activeAt) -- it must NOT win, or the meter flickers.
  const out = t.record("idle", mk(5, 1005), 100, 1005);
  expect(out?.fiveHour?.usedPercentage).toBe(62);
});

it("prunes a session that stopped emitting past the stale window", () => {
  const t = new QuotaTracker(120);
  t.record("gone", mk(62, 1000), 9000, 1000); // active, then goes silent
  // now=2000; gone.emitAt=1000 -> 1000s idle > 120 -> pruned; only 'live' left.
  const out = t.record("live", mk(5, 1000), 500, 2000);
  expect(out?.fiveHour?.usedPercentage).toBe(5);
});

it("returns null when no sessions are tracked", () => {
  expect(new QuotaTracker(120).current(0)).toBeNull();
});

it("ignores a session that stopped emitting in favor of a live one", () => {
  const t = new QuotaTracker(120, 20);
  // Most-active session (e.g. a VS Code panel) goes silent after this emit.
  t.record("vscode", mk(42, 1000), 9000, 1000);
  // 60s later -- within the 120s prune but past the 20s live window -- a live
  // session emits. The silent one must not shadow it: its frozen updatedAt
  // would read as "no active session" and blank the meter.
  const out = t.record("term", mk(42, 1060), 500, 1060);
  expect(out?.updatedAt).toBe(1060);
});

it("prefers the freshest account-wide snapshot among live sessions", () => {
  const t = new QuotaTracker(120, 20);
  t.record("working", mk(42, 1000), 5000, 1000); // current truth: 42%
  // An idle-but-open session re-emits its ANCIENT 5% snapshot and even has a
  // newer transcript touch; account usage only climbs within a window, so the
  // higher percentage is the newer fact and must win.
  const out = t.record("vscode", mk(5, 1005), 9000, 1005);
  expect(out?.fiveHour?.usedPercentage).toBe(42);
});

it("a new rate-limit window (later resetsAt) beats the old window's higher %", () => {
  const t = new QuotaTracker(120, 20);
  const oldWindow: QuotaStatus = {
    ...mk(80, 1000),
    fiveHour: { usedPercentage: 80, resetsAt: 5000 },
  };
  t.record("a", oldWindow, 5000, 1000);
  const freshWindow: QuotaStatus = {
    ...mk(2, 1004),
    fiveHour: { usedPercentage: 2, resetsAt: 23000 },
  };
  const out = t.record("b", freshWindow, 4000, 1004);
  expect(out?.fiveHour?.usedPercentage).toBe(2);
});

it("carries a session's last-known windows forward across a rate-limit-less emit", () => {
  const t = new QuotaTracker(120);
  t.record("s", mk(62, 1000), 9000, 1000);
  const blank: QuotaStatus = {
    fiveHour: null,
    sevenDay: null,
    model: null,
    updatedAt: 1002,
    available: false,
  };
  const out = t.record("s", blank, 9001, 1002); // same session, transient gap
  expect(out?.available).toBe(true); // mergeQuota carried 62% forward
  expect(out?.fiveHour?.usedPercentage).toBe(62);
});
