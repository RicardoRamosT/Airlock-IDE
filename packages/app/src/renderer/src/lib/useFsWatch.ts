import { useEffect } from "react";
import { useApp } from "../store";

// Subscribe once (per window) to the main-process fs:changed watcher and bump
// the per-root freshness counter so every FileTree on that root re-lists.
export function useFsWatch(): void {
  const bumpFsVersion = useApp((s) => s.bumpFsVersion);
  useEffect(
    () => window.airlock.onFsChanged((e) => bumpFsVersion(e.root)),
    [bumpFsVersion],
  );
}
