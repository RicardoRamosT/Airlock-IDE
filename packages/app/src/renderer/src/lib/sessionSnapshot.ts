import type { SessionSnapshot } from "../../../shared/ipc";

// Minimal shape this builder needs from the store (kept local so the function is
// pure + unit-testable without the full AppState).
interface SnapshotInput {
  tabs: { id: string; root: string | null }[];
  activeTabId: string;
  split: { a: string; b: string } | null;
  stripOrder: string[];
  tabTerminals: Record<string, { claudeAutoId: string | null } | undefined>;
  // Tabs awaiting a lazy `claude --continue` on first focus. A pending tab HAD a
  // Claude session (that is why it is pending) but has not been resumed yet, so
  // its claudeAutoId is still null -- count it as hadClaude or the snapshot drops
  // it and the next restore fresh-starts claude. Optional so callers/tests that
  // do not track it default to "nothing pending".
  pendingResume?: ReadonlySet<string>;
}

// Build the restorable snapshot: project tabs (root != null) in strip order,
// each with hadClaude derived from its auto-Claude claim; the split + active tab
// mapped from ephemeral tab ids to durable roots. Blank tabs are omitted.
export function buildSessionSnapshot(s: SnapshotInput): SessionSnapshot {
  const byId = new Map(s.tabs.map((t) => [t.id, t]));
  const project = s.tabs.filter((t) => t.root !== null);
  // Order: stripOrder entries that are project tabs first, then any project tab
  // not present in stripOrder (defensive), preserving tabs order.
  const ordered: { id: string; root: string | null }[] = [];
  const seen = new Set<string>();
  for (const id of s.stripOrder) {
    const t = byId.get(id);
    if (t && t.root !== null) {
      ordered.push(t);
      seen.add(id);
    }
  }
  for (const t of project) if (!seen.has(t.id)) ordered.push(t);

  const tabs = ordered.map((t) => ({
    root: t.root as string,
    // claudeAutoId covers a started/resumed tab; pendingResume covers a restored
    // tab not yet switched to (still pending its lazy --continue).
    hadClaude:
      s.tabTerminals[t.id]?.claudeAutoId != null ||
      (s.pendingResume?.has(t.id) ?? false),
  }));
  const rootOf = (id: string): string | null => byId.get(id)?.root ?? null;
  const activeRoot = rootOf(s.activeTabId);
  let split: { a: string; b: string } | null = null;
  if (s.split) {
    const a = rootOf(s.split.a);
    const b = rootOf(s.split.b);
    if (a !== null && b !== null) split = { a, b };
  }
  return { version: 1, tabs, activeRoot, split };
}
