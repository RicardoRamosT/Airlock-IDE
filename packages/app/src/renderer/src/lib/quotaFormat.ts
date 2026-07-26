// Format remaining seconds as a compact countdown: "2d 3h", "1h12m", "4m",
// "<1m", or "now" when not positive. Pure + deterministic for tests.
export function formatCountdown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m`;
  return "<1m";
}

export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

// Our installed statusLine re-runs every ~5s while a Claude session is open, so
// an emit older than this (a few missed ticks of jitter slack) means no session is
// currently running and the numbers would be a stale snapshot.
export const STALE_AFTER_SECONDS = 15;

// Severity of a usage percentage, so the titlebar gauge changes COLOR as well as
// length -- a bar that only grows makes "nearly out" something you have to read
// rather than notice. Thresholds are deliberately late: the meter should stay
// calm through normal work and only speak up when the window is genuinely
// running down.
export type QuotaTone = "ok" | "warn" | "crit";
export function quotaTone(pct: number): QuotaTone {
  const p = clampPct(pct);
  if (p >= 85) return "crit";
  if (p >= 60) return "warn";
  return "ok";
}

// Whether a window should read as "starts on next use" rather than a countdown.
// Either the tracker already synthesized the awaiting row (its reset was seen
// passed at emit time), OR the boundary has passed since the last emit by the
// UI's own clock -- in the gap before the next 5s emit re-flags it, rendering
// the countdown would show a nonsensical "now". The tracker decides at EMIT
// time; the UI ticks every second, so it must guard the boundary itself.
export function isWindowAwaiting(
  w: { resetsAt: number; awaitingNextWindow?: true },
  now: number,
): boolean {
  return w.awaitingNextWindow === true || w.resetsAt - now <= 0;
}
