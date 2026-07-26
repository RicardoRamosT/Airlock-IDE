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

// The two levels that mean something: fully yellow at 75% used, fully red at 90%.
export const QUOTA_YELLOW_AT = 75;
export const QUOTA_RED_AT = 90;

// Colour ramp stops. Interpolating in HSL keeps the whole cool->warm story on one
// monotonic hue sweep; lerping the RGB literals instead passes through muddy
// grey-greens. The yellow is deliberately ORANGE-leaning (hue 42, not 60) -- pure
// yellow is both harsher and the worst case for text contrast. Lightness is capped
// in the mid-50s so the white percentage stays legible over the fill (see
// .titlebar-wing-num's halo in theme.css).
const RAMP = [
  { p: 0, h: 212, s: 75, l: 60 }, // calm blue: plenty left
  { p: QUOTA_YELLOW_AT / 100, h: 42, s: 92, l: 50 }, // orange-yellow: getting on
  { p: QUOTA_RED_AT / 100, h: 2, s: 78, l: 52 }, // red: nearly out
] as const;

// Fill colour for a usage percentage. CONTINUOUS rather than stepped -- the colour
// is the reading, so it moves with the number instead of jumping at a threshold --
// but it lands exactly on yellow at 75% and red at 90%, and holds red above that.
// The first leg is eased (power curve) so light usage still reads clearly BLUE
// rather than drifting to cyan the moment the bar leaves zero.
export function quotaFillColor(pct: number): string {
  const p = clampPct(pct) / 100;
  const [blue, yellow, red] = RAMP;
  let h: number;
  let s: number;
  let l: number;
  if (p >= red.p) {
    ({ h, s, l } = red); // pinned red for the last stretch
  } else if (p <= yellow.p) {
    const t = (p / yellow.p) ** 1.6;
    h = blue.h + (yellow.h - blue.h) * t;
    s = blue.s + (yellow.s - blue.s) * t;
    l = blue.l + (yellow.l - blue.l) * t;
  } else {
    const t = (p - yellow.p) / (red.p - yellow.p);
    h = yellow.h + (red.h - yellow.h) * t;
    s = yellow.s + (red.s - yellow.s) * t;
    l = yellow.l + (red.l - yellow.l) * t;
  }
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;
}

// The hue of quotaFillColor, exposed for tests/assertions.
export function quotaFillHue(pct: number): number {
  const m = /^hsl\((\d+)/.exec(quotaFillColor(pct));
  return m ? Number(m[1]) : Number.NaN;
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
