import type { DirEntry } from "../../../shared/ipc";

// Apply a saved name order to the default-sorted entries. Saved names that still
// exist come first in saved order; entries not named (new since the last save)
// keep their incoming (default-sort) order at the end; saved names with no entry
// (deleted/renamed) are dropped. No saved order -> entries returned as-is (same
// reference, so callers can cheaply skip re-renders).
export function applyOrder(
  entries: DirEntry[],
  names: string[] | undefined,
): DirEntry[] {
  if (!names || names.length === 0) return entries;
  const byName = new Map(entries.map((e) => [e.name, e]));
  const ordered: DirEntry[] = [];
  for (const n of names) {
    const e = byName.get(n);
    if (e) {
      ordered.push(e);
      byName.delete(n);
    }
  }
  for (const e of entries) if (byName.has(e.name)) ordered.push(e);
  return ordered;
}

// Which band of a row a drag is over, from the pointer Y against the row rect.
// "into" exists only for a directory's middle (move INTO it); a file's whole row
// splits before/after. Drives the reorder-vs-move-into decision in FileTree.
export type Zone = "before" | "after" | "into";
export function dropZone(
  rect: { top: number; height: number },
  clientY: number,
  isDir: boolean,
): Zone {
  const offset = clientY - rect.top;
  if (!isDir) return offset < rect.height / 2 ? "before" : "after";
  const edge = rect.height * 0.25;
  if (offset < edge) return "before";
  if (offset > rect.height - edge) return "after";
  return "into";
}

// Compute a folder's new name order after dropping `dragged` before/after
// `target`. Returns the SAME array reference when nothing changes (dragged ===
// target, or target not present) so callers can skip a needless write.
export function reorderNames(
  names: string[],
  dragged: string,
  target: string,
  place: "before" | "after",
): string[] {
  if (dragged === target) return names;
  const without = names.filter((n) => n !== dragged);
  const ti = without.indexOf(target);
  if (ti < 0) return names;
  const at = place === "before" ? ti : ti + 1;
  return [...without.slice(0, at), dragged, ...without.slice(at)];
}
