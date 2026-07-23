import { useEffect } from "react";
import { useApp } from "../store";

// When the focused project changes, ask main to (best-effort) switch the
// machine's active gh account to the project's account, so a terminal `git push`
// there uses the right account. Pinned projects apply their pin; non-pinned use
// detection (owner, else commit name). The pref gates non-pinned (checked
// main-side too).
//
// DEBOUNCED (250ms): tabbing quickly THROUGH a project must not fire a switch
// for it. Without this, hopping A -> B spawns two concurrent `gh auth switch`
// subprocesses that can complete OUT OF ORDER, leaving the wrong account active
// on B (diagnosed: aparatosauditivos -> LendLogic left RicardoRamosT active
// instead of vnricardotrevino). Only the project you actually land on fires.
export function useGithubFocusSync(): void {
  const root = useApp((s) => s.tabState[s.activeTabId ?? ""]?.root ?? null);
  useEffect(() => {
    if (!root) return;
    const t = setTimeout(() => {
      void window.airlock.githubAutoSwitchOnFocus(root);
    }, 250);
    return () => clearTimeout(t);
  }, [root]);
}
