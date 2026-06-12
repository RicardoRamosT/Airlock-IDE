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
