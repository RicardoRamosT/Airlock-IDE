import { useEffect } from "react";
import { useApp } from "../store";

/** Load app-global layout prefs once at startup and hydrate the store. */
export function usePrefs(): void {
  const setSidebarVisible = useApp((s) => s.setSidebarVisible);
  const setSidebarPosition = useApp((s) => s.setSidebarPosition);
  const setTheme = useApp((s) => s.setTheme);
  const setSectionVisibility = useApp((s) => s.setSectionVisibility);
  const theme = useApp((s) => s.theme);

  useEffect(() => {
    let cancelled = false;
    window.airlock
      .prefsGet()
      .then((p) => {
        // Theme rides the same layoutHydrated guard as the layout prefs: this
        // one guard gates the whole hydrate, so once it has run (or been
        // skipped because state was already established) it never re-applies
        // and clobbers a later user choice. Setting theme here, inside the
        // guarded .then, keeps a single hydration ordering for all app-global
        // prefs rather than introducing a parallel flag.
        if (cancelled || useApp.getState().layoutHydrated) return;
        setSidebarVisible(p.sidebarVisible);
        setSidebarPosition(p.sidebarPosition);
        setTheme(p.theme);
        setSectionVisibility(p.sectionVisibility);
        useApp.getState().setLayoutHydrated(true);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [setSidebarVisible, setSidebarPosition, setTheme, setSectionVisibility]);

  // Runtime visibility changes (View menu or right-click) arrive as an
  // authoritative push from main. Mark hydrated first so a late startup
  // prefsGet cannot clobber the user's live change (the recurring hydrate race).
  useEffect(() => {
    return window.airlock.onSectionsChanged((v) => {
      useApp.getState().setLayoutHydrated(true);
      useApp.getState().setSectionVisibility(v);
    });
  }, []);

  // Apply the active theme to the DOM whenever it changes. This single effect
  // covers BOTH hydrate (store.theme updated above) and any live toggle, so
  // the CSS [data-theme] override on <html> always tracks store.theme. Default
  // dark needs no attribute (the bare :root is the dark palette), but writing
  // it explicitly keeps the attribute authoritative for either direction.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
}
