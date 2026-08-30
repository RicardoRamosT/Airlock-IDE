// Elapsed time for the thinking indicator. Past a minute, "68s" stops being
// readable at a glance -- the eye has to do arithmetic to know it is over a
// minute. Minutes and seconds are read instantly.
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? `${m}m` : `${m}m ${rest}s`;
}
