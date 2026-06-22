// Freshness helpers for the Overview summary. Pure so they unit-test cleanly;
// the component supplies `now` (Date.now()) and the detected area paths.

// Coarse "generated X ago" label from a file mtime. Buckets, not exact — the
// Overview just needs a glanceable sense of how stale the summary is.
export function relativeTime(fromMs: number, nowMs: number): string {
  const s = Math.floor(Math.max(0, nowMs - fromMs) / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Detected area paths that the written summary never mentions — a cheap drift
// signal for "an area was added since this was generated, regenerate to cover
// it". An area Claude documented has its path in the prose (the prompt seeds
// "Areas to cover: <paths>" and links entry files under them), so a path that
// is absent is very likely uncovered.
export function uncoveredAreaPaths(
  summary: string,
  areaPaths: string[],
): string[] {
  return areaPaths.filter((p) => p.length > 0 && !summary.includes(p));
}
