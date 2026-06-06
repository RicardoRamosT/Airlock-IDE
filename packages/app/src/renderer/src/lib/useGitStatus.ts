import { useEffect } from "react";
import { useApp } from "../store";
import { useProjectTab } from "./projectPane";

/**
 * Keeps store.gitStatus fresh independently of the collapsible Git section
 * (which unmounts when collapsed). Owns the window-focus refresh. Scoped to the
 * pane's tab so each visible pane keeps its own project's git status fresh.
 */
export function useGitStatus(): void {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const setGitStatus = useApp((s) => s.setGitStatus);

  useEffect(() => {
    if (!root) {
      setGitStatus(null, tabId);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const repo = await window.airlock.gitIsRepo();
        const status = repo ? await window.airlock.gitStatus() : null;
        if (!cancelled) setGitStatus(status, tabId);
      } catch (err) {
        console.error("git status refresh failed", err);
        if (!cancelled) setGitStatus(null, tabId);
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
    };
  }, [root, setGitStatus, tabId]);
}
