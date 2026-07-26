import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { startFocusPolling } from "./focusPolling";
import { type GithubDot, githubAccountDot } from "./githubDot";

// Same gentle cadence as the section dots (useSectionStatuses): this fans out to
// `gh auth status` + a remote/config read, and the dot is an at-a-glance hint,
// not a monitor. Focus-gated, so a backgrounded window stops polling. It also
// re-reads immediately when the focused project changes, and the rail refreshes
// it when the Accounts popover closes (a switch/pin lands right away).
const POLL_MS = 30000;

export function useGithubAccountDot(): [GithubDot, () => void] {
  // The Accounts button is app-global (one rail per window), so read the FOCUSED
  // tab's root -- exactly what AccountsPopover pins/resolves against.
  const root = useApp((s) => s.tabState[s.activeTabId ?? ""]?.root ?? null);
  const [dot, setDot] = useState<GithubDot>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(() => {
    void Promise.all([
      window.airlock.githubInfo(),
      root ? window.airlock.resolveGithubAccount(root) : Promise.resolve(null),
    ])
      .then(([info, resolved]) => {
        if (mounted.current) setDot(githubAccountDot(info, resolved));
      })
      .catch(() => {
        if (mounted.current) setDot(null);
      });
  }, [root]);

  useEffect(() => {
    load();
    return startFocusPolling(load, POLL_MS, {
      hasFocus: () => document.hasFocus(),
      setInterval: (fn, ms) => window.setInterval(fn, ms),
      clearInterval: (id) => window.clearInterval(id),
      addEventListener: (type, fn) => window.addEventListener(type, fn),
      removeEventListener: (type, fn) => window.removeEventListener(type, fn),
    });
  }, [load]);

  return [dot, load];
}
