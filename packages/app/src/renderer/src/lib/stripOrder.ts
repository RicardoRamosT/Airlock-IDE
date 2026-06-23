// Pure helpers for the project strip's drag-to-reorder presentation order.
// The strip renders from a reconciled list of opaque string keys (stripOrder);
// the actual array splice on drop reuses fileOrder's `reorderNames`.

// Keep `stored` keys that are still live (in their stored order), then append
// any live keys not yet ordered (new since the last save). Stale stored keys
// are dropped. Mirrors fileOrder.applyOrder, but for opaque string keys.
export function reconcileOrder(stored: string[], live: string[]): string[] {
  const liveSet = new Set(live);
  const kept = stored.filter((k) => liveSet.has(k));
  const seen = new Set(kept);
  return [...kept, ...live.filter((k) => !seen.has(k))];
}

// The live strip-entry keys in their default order: project tabs in `tabs`
// order (a split pair collapses to a single "pair" key at member a's slot;
// member b is omitted), then the open IDE page-tabs in a fixed order.
export function stripLiveKeys(
  tabs: { id: string }[],
  split: { a: string; b: string } | null,
  pages: { settings: boolean; usage: boolean; overviews: string[] },
): string[] {
  const keys: string[] = [];
  for (const t of tabs) {
    if (split && t.id === split.b) continue;
    keys.push(split && t.id === split.a ? "pair" : t.id);
  }
  if (pages.settings) keys.push("page:settings");
  if (pages.usage) keys.push("page:usage");
  // One Overview chip per open root (Overview is per-project; multiple coexist).
  for (const root of pages.overviews) keys.push(`page:overview:${root}`);
  return keys;
}

// Horizontal drop placement for a tab: left half -> before, right half (and the
// exact midpoint) -> after. The tab-bar analogue of fileOrder.dropZone.
export function dropPlace(
  rect: { left: number; width: number },
  clientX: number,
): "before" | "after" {
  return clientX < rect.left + rect.width / 2 ? "before" : "after";
}
