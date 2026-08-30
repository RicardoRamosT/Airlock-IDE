// ASCII comments only. Turn what AirLock already knows into a list of candidate
// project roots. This is why Atlas needs ZERO configuration on first run: the
// user's own history seeds the portfolio, whatever directory layout they use.

// Open tabs first (strongest signal of current work), then recents. Both lists
// are user-supplied data, so entries are trimmed and de-duplicated.
export function seedRoots(
  recentFolders: readonly string[],
  openTabRoots: readonly string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...openTabRoots, ...recentFolders]) {
    const root = raw.trim();
    if (root.length === 0) continue;
    if (seen.has(root)) continue;
    seen.add(root);
    out.push(root);
  }
  return out;
}
