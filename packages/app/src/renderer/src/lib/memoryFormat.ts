import type { MemKind, MemProc } from "../../../shared/ipc";

// Decimal units (1 GB = 1e9 B) to match macOS Activity Monitor / Finder.
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}

export function kindLabel(kind: MemKind): string {
  switch (kind) {
    case "airlock-main":
      return "AirLock";
    case "airlock-helper":
      return "AirLock helper";
    case "claude":
      return "Claude";
    case "language-server":
      return "Language server";
    case "shell":
      return "Shell";
    case "node":
      return "node";
    default:
      return "Other";
  }
}

export type SortCol = "footprint" | "kind" | "project" | "pid";

// Sort a copy by the chosen column, but always pin the synthetic rollup row
// (pid -1) to the bottom so it never sorts into the middle of real processes.
export function sortProcs(
  procs: MemProc[],
  col: SortCol,
  dir: "asc" | "desc",
): MemProc[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...procs].sort((a, b) => {
    if (a.pid === -1) return 1;
    if (b.pid === -1) return -1;
    let cmp: number;
    if (col === "footprint" || col === "pid") cmp = a[col] - b[col];
    else cmp = String(a[col] ?? "").localeCompare(String(b[col] ?? ""));
    return sign * cmp;
  });
}
