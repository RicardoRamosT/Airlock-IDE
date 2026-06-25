import { useEffect, useRef, useState } from "react";
import type { SectionStatuses } from "../../../shared/ipc";
import { useApp } from "../store";
import { startFocusPolling } from "./focusPolling";
import { useProjectTab } from "./projectPane";

// Poll cadence for the activity-rail status dots. Deliberately gentle: the
// aggregate fans out to live probes (DB pings, the dev-server probe, gh/Render),
// so we re-check only every 30s and pause entirely when the window is
// backgrounded (startFocusPolling). The dots are an at-a-glance health hint, not
// a real-time monitor. Re-runs immediately when the focused project changes.
const POLL_MS = 30000;

export function useSectionStatuses(): SectionStatuses | null {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const [statuses, setStatuses] = useState<SectionStatuses | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const load = () =>
      void window.airlock
        .sectionStatuses(root)
        .then((s) => {
          if (mounted.current) setStatuses(s);
        })
        .catch(() => {});
    load();
    return startFocusPolling(load, POLL_MS, {
      hasFocus: () => document.hasFocus(),
      setInterval: (fn, ms) => window.setInterval(fn, ms),
      clearInterval: (id) => window.clearInterval(id),
      addEventListener: (type, fn) => window.addEventListener(type, fn),
      removeEventListener: (type, fn) => window.removeEventListener(type, fn),
    });
  }, [root]);

  return statuses;
}
