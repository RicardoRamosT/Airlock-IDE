import { useEffect } from "react";
import { useApp } from "../store";

/** Load app-global layout prefs once at startup and hydrate the store. */
export function usePrefs(): void {
  const setSidebarVisible = useApp((s) => s.setSidebarVisible);
  const setSidebarPosition = useApp((s) => s.setSidebarPosition);
  const setSidebarWidth = useApp((s) => s.setSidebarWidth);
  const setTheme = useApp((s) => s.setTheme);
  const setClipboardClearSeconds = useApp((s) => s.setClipboardClearSeconds);
  const setEditorFontSize = useApp((s) => s.setEditorFontSize);
  const setOpenProjectsAsTabs = useApp((s) => s.setOpenProjectsAsTabs);
  const setShowRunningProcessNotice = useApp(
    (s) => s.setShowRunningProcessNotice,
  );
  const setSectionVisibility = useApp((s) => s.setSectionVisibility);
  const setActiveView = useApp((s) => s.setActiveView);
  const setClaudeAutoStart = useApp((s) => s.setClaudeAutoStart);
  const setRestoreSession = useApp((s) => s.setRestoreSession);
  const setDefaultTerminal = useApp((s) => s.setDefaultTerminal);
  const setQuotaMeterEnabled = useApp((s) => s.setQuotaMeterEnabled);
  const setDockStatusEnabled = useApp((s) => s.setDockStatusEnabled);
  const setRunAppSkillEnabled = useApp((s) => s.setRunAppSkillEnabled);
  const setSelfVerifyEnabled = useApp((s) => s.setSelfVerifyEnabled);
  const setExtensionsPrefs = useApp((s) => s.setExtensionsPrefs);
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
        setSidebarWidth(p.sidebarWidth);
        setTheme(p.theme);
        setClipboardClearSeconds(p.clipboardClearSeconds);
        setEditorFontSize(p.editorFontSize);
        setOpenProjectsAsTabs(p.openProjectsAsTabs);
        setShowRunningProcessNotice(p.showRunningProcessNotice);
        setSectionVisibility(p.sectionVisibility);
        setActiveView(p.activeView);
        setClaudeAutoStart(p.claudeAutoStart);
        setRestoreSession(p.restoreSession);
        setDefaultTerminal(p.defaultTerminal);
        setQuotaMeterEnabled(p.quotaMeter.enabled);
        setDockStatusEnabled(p.dockStatus.enabled);
        setRunAppSkillEnabled(p.runAppSkill.enabled);
        setSelfVerifyEnabled(p.selfVerify.enabled);
        setExtensionsPrefs(p.extensions ?? {});
        useApp.getState().setLayoutHydrated(true);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [
    setSidebarVisible,
    setSidebarPosition,
    setSidebarWidth,
    setTheme,
    setClipboardClearSeconds,
    setEditorFontSize,
    setOpenProjectsAsTabs,
    setShowRunningProcessNotice,
    setSectionVisibility,
    setActiveView,
    setClaudeAutoStart,
    setRestoreSession,
    setDefaultTerminal,
    setQuotaMeterEnabled,
    setDockStatusEnabled,
    setRunAppSkillEnabled,
    setSelfVerifyEnabled,
    setExtensionsPrefs,
  ]);

  // Runtime visibility changes (View menu or right-click) arrive as an
  // authoritative push from main. Mark hydrated first so a late startup
  // prefsGet cannot clobber the user's live change (the recurring hydrate race).
  useEffect(() => {
    return window.airlock.onSectionsChanged((v) => {
      useApp.getState().setLayoutHydrated(true);
      useApp.getState().setSectionVisibility(v);
    });
  }, []);

  // Live app-global prefs push (e.g. the set_pref MCP tool changing a pref from
  // the backend): re-apply the slices so the UI reflects it without a restart.
  // Authoritative like onSectionsChanged -- mark hydrated so a late startup
  // prefsGet cannot clobber it. getState() setters are stable, so deps are empty.
  useEffect(() => {
    return window.airlock.onPrefsChanged((p) => {
      const s = useApp.getState();
      s.setLayoutHydrated(true);
      s.setSidebarVisible(p.sidebarVisible);
      s.setSidebarPosition(p.sidebarPosition);
      s.setSidebarWidth(p.sidebarWidth);
      s.setTheme(p.theme);
      s.setClipboardClearSeconds(p.clipboardClearSeconds);
      s.setEditorFontSize(p.editorFontSize);
      s.setOpenProjectsAsTabs(p.openProjectsAsTabs);
      s.setShowRunningProcessNotice(p.showRunningProcessNotice);
      s.setSectionVisibility(p.sectionVisibility);
      s.setActiveView(p.activeView);
      s.setClaudeAutoStart(p.claudeAutoStart);
      s.setRestoreSession(p.restoreSession);
      s.setDefaultTerminal(p.defaultTerminal);
      s.setQuotaMeterEnabled(p.quotaMeter.enabled);
      s.setDockStatusEnabled(p.dockStatus.enabled);
      s.setRunAppSkillEnabled(p.runAppSkill.enabled);
      s.setSelfVerifyEnabled(p.selfVerify.enabled);
      s.setExtensionsPrefs(p.extensions ?? {});
    });
  }, []);

  // The agent (via the request_secret MCP tool) asks the user to vault a secret.
  // Main pushes agent:request-secret; open the secure modal for it. SecretModal
  // reports the outcome back so the awaiting agent is never stranded.
  useEffect(() => {
    return window.airlock.onRequestSecret((p) => {
      useApp.getState().setModal({ requestSecret: p });
    });
  }, []);

  // The agent (via send_terminal_input) asks to type into a live terminal. Main
  // pushes agent:terminal-grant-request; open the approval modal for it. The
  // modal reports allow/deny back so the awaiting agent is never stranded.
  useEffect(() => {
    return window.airlock.onTerminalGrantRequest((p) => {
      useApp.getState().setModal({ grantTerminal: p });
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
