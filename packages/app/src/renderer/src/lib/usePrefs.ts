import { useEffect } from "react";
import { useApp } from "../store";

/** Load app-global layout prefs once at startup and hydrate the store. */
export function usePrefs(): void {
  const setSidebarVisible = useApp((s) => s.setSidebarVisible);
  const setSidebarPosition = useApp((s) => s.setSidebarPosition);
  useEffect(() => {
    let cancelled = false;
    window.airlock
      .prefsGet()
      .then((p) => {
        if (cancelled || useApp.getState().layoutHydrated) return;
        setSidebarVisible(p.sidebarVisible);
        setSidebarPosition(p.sidebarPosition);
        useApp.getState().setLayoutHydrated(true);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [setSidebarVisible, setSidebarPosition]);
}
