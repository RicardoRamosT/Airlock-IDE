import { useEffect } from "react";
import { useApp } from "../store";

// When the focused project changes, ask main to (best-effort) switch the
// machine's active gh account to a NON-PINNED project's detected account, so a
// terminal `git push` there uses the right account. Pinned projects carry their
// own per-repo credential helper and are left untouched main-side; the
// githubAutoSwitch pref gates the whole thing (checked main-side too).
export function useGithubFocusSync(): void {
  const root = useApp((s) => s.tabState[s.activeTabId ?? ""]?.root ?? null);
  useEffect(() => {
    if (root) void window.airlock.githubAutoSwitchOnFocus(root);
  }, [root]);
}
