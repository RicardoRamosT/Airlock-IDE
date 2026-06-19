import { useEffect } from "react";
import { useApp } from "../store";
import { buildSessionSnapshot } from "./sessionSnapshot";

// Persist the restorable layout (debounced) whenever it changes. Gated on
// layoutHydrated + restoreSession + sessionRestoreDone so we never overwrite a
// good snapshot with the transient boot state before restore has run.
const DEBOUNCE_MS = 500;

export function useSessionPersist(): void {
  // Subscribe to the slices that affect the snapshot.
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const split = useApp((s) => s.split);
  const stripOrder = useApp((s) => s.stripOrder);
  const tabTerminals = useApp((s) => s.tabTerminals);
  const layoutHydrated = useApp((s) => s.layoutHydrated);
  const restoreSession = useApp((s) => s.restoreSession);
  const restoreDone = useApp((s) => s.sessionRestoreDone);

  // The layout slices below are intentional change-triggers, not read in the
  // body (the effect snapshots fresh state via useApp.getState()) -- they make
  // the debounced save re-fire whenever the layout changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger deps, not used in the body
  useEffect(() => {
    if (!layoutHydrated || !restoreSession || !restoreDone) return;
    const id = setTimeout(() => {
      window.airlock.sessionSave(buildSessionSnapshot(useApp.getState()));
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [
    tabs,
    activeTabId,
    split,
    stripOrder,
    tabTerminals,
    layoutHydrated,
    restoreSession,
    restoreDone,
  ]);
}
