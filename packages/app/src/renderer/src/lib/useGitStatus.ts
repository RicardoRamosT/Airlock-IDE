import { useEffect } from "react";
import { useApp } from "../store";

/**
 * Keeps store.gitStatus fresh independently of the collapsible Git section
 * (which unmounts when collapsed). Owns the window-focus refresh.
 */
export function useGitStatus(): void {
  const root = useApp((s) => s.root);
  const setGitStatus = useApp((s) => s.setGitStatus);

  useEffect(() => {
    if (!root) {
      setGitStatus(null);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const repo = await window.airlock.gitIsRepo();
        const status = repo ? await window.airlock.gitStatus() : null;
        if (!cancelled) setGitStatus(status);
      } catch (err) {
        console.error("git status refresh failed", err);
        if (!cancelled) setGitStatus(null);
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
    };
  }, [root, setGitStatus]);
}
