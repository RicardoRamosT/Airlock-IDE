export interface FuzzyMatch {
  score: number;
  indices: number[];
}

// True if position i in text starts a "word": index 0, just after a separator
// (/ \ _ - . space), or a lower->Upper camelCase edge.
function isBoundary(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1] ?? "";
  if (/[/\\_\-. ]/.test(prev)) return true;
  const cur = text[i] ?? "";
  return (
    prev === prev.toLowerCase() &&
    cur === cur.toUpperCase() &&
    cur !== cur.toLowerCase()
  );
}

// Case-insensitive subsequence fuzzy match. null if `query` is not a subsequence
// of `text`. Higher score = better; rewards consecutive runs and word-boundary
// hits. `indices` are matched positions in `text` (for highlighting). An empty
// query matches everything with score 0.
export function fuzzyScore(query: string, text: string): FuzzyMatch | null {
  if (query === "") return { score: 0, indices: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let qi = 0;
  let prev = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    let bonus = 1;
    if (ti === prev + 1) bonus += 2; // consecutive
    if (isBoundary(text, ti)) bonus += 3; // word boundary
    score += bonus;
    indices.push(ti);
    prev = ti;
    qi++;
  }
  if (qi < q.length) return null;
  return { score: score - text.length * 0.01, indices }; // tiny shorter-is-better tilt
}

// Score `items` by `key`, drop non-matches, sort best-first (then shorter key,
// then lexicographic for stability). Empty query preserves the input order.
export function fuzzyFilter<T>(
  query: string,
  items: T[],
  key: (t: T) => string,
): { item: T; match: FuzzyMatch }[] {
  const out: { item: T; match: FuzzyMatch }[] = [];
  for (const item of items) {
    const match = fuzzyScore(query, key(item));
    if (match) out.push({ item, match });
  }
  if (query !== "") {
    out.sort(
      (a, b) =>
        b.match.score - a.match.score ||
        key(a.item).length - key(b.item).length ||
        key(a.item).localeCompare(key(b.item)),
    );
  }
  return out;
}
