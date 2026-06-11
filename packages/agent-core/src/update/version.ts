// Pure semver-ish compare. Strips a leading "v", numeric per-segment compare,
// missing/non-numeric segments treated as 0. Enough for our 0.x.y tags.
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const seg = (v: string) =>
    v.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pa = seg(a);
  const pb = seg(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

export function isNewer(current: string, latest: string): boolean {
  return compareVersions(latest, current) === 1;
}
