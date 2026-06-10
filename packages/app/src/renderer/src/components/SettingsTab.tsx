import { useEffect } from "react";
import type { ClaudeAutoStart } from "../../../shared/ipc";
import { useProjectTab } from "../lib/projectPane";
import { useApp } from "../store";
import { AgentSection } from "./AgentSection";

// The Settings tab opens in the viewer-pane slot (mutually exclusive with a
// file or diff). It surfaces airlock's existing, real settings in one place;
// every control reflects the current store/config value and persists on change
// (prefs for app-global, project config for secrets). All styling uses theme
// vars so it inverts with the light palette.
export function SettingsTab() {
  const setSettingsOpen = useApp((s) => s.setSettingsOpen);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const sidebarPosition = useApp((s) => s.sidebarPosition);
  const setSidebarPosition = useApp((s) => s.setSidebarPosition);
  const sidebarVisible = useApp((s) => s.sidebarVisible);
  const setSidebarVisible = useApp((s) => s.setSidebarVisible);
  const clipboardClearSeconds = useApp((s) => s.clipboardClearSeconds);
  const setClipboardClearSeconds = useApp((s) => s.setClipboardClearSeconds);
  const openProjectsAsTabs = useApp((s) => s.openProjectsAsTabs);
  const setOpenProjectsAsTabs = useApp((s) => s.setOpenProjectsAsTabs);
  const showRunningProcessNotice = useApp((s) => s.showRunningProcessNotice);
  const setShowRunningProcessNotice = useApp(
    (s) => s.setShowRunningProcessNotice,
  );
  const quotaMeterEnabled = useApp((s) => s.quotaMeterEnabled);
  const setQuotaMeterEnabled = useApp((s) => s.setQuotaMeterEnabled);
  const claudeAutoStart = useApp((s) => s.claudeAutoStart);
  const setClaudeAutoStart = useApp((s) => s.setClaudeAutoStart);
  // Per-project bits are scoped to the pane's tab; the app-global controls above
  // (theme, sidebar, clipboard, openProjectsAsTabs, showRunningProcessNotice)
  // stay app-global and are deliberately NOT tied to a tab.
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const config = useApp((s) => s.tabState[tabId]?.config ?? null);
  const setConfig = useApp((s) => s.setConfig);

  // Populate config when a folder is open but the store has not loaded it yet
  // (e.g. the user never opened the secrets section). No-op when already set.
  useEffect(() => {
    if (root && !config) {
      window.airlock
        .configGet(root)
        .then((c) => setConfig(c, tabId))
        .catch(console.error);
    }
  }, [root, config, setConfig, tabId]);

  // Each persisted change marks layoutHydrated so a still-in-flight startup
  // prefsGet cannot clobber a fast user choice (same race the layout buttons
  // guard against).
  const chooseTheme = (t: "dark" | "light") => {
    useApp.getState().setLayoutHydrated(true);
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);
    void window.airlock.prefsSet({ theme: t });
  };

  const choosePosition = (p: "left" | "right") => {
    useApp.getState().setLayoutHydrated(true);
    setSidebarPosition(p);
    void window.airlock.prefsSet({ sidebarPosition: p });
  };

  const toggleSidebarVisible = () => {
    useApp.getState().setLayoutHydrated(true);
    const next = !sidebarVisible;
    setSidebarVisible(next);
    void window.airlock.prefsSet({ sidebarVisible: next });
  };

  const toggleInject = async () => {
    if (!root) return;
    const next = await window.airlock.configSet(root, {
      injectSecretsIntoTerminal: !(config?.injectSecretsIntoTerminal ?? false),
    });
    setConfig(next, tabId);
  };

  return (
    <div className="settings-tab">
      <div className="settings-tab-header">
        <span>Settings</span>
        <button
          type="button"
          className="viewer-close"
          title="Close settings"
          onClick={() => setSettingsOpen(false)}
        >
          <i className="codicon codicon-close" />
        </button>
      </div>

      <div className="settings-body">
        <section className="settings-section">
          <h3>Appearance</h3>
          <label className="settings-row">
            <input
              type="radio"
              name="theme"
              checked={theme === "dark"}
              onChange={() => chooseTheme("dark")}
            />
            Dark
          </label>
          <label className="settings-row">
            <input
              type="radio"
              name="theme"
              checked={theme === "light"}
              onChange={() => chooseTheme("light")}
            />
            Light
          </label>
        </section>

        <section className="settings-section">
          <h3>Layout</h3>
          <div className="settings-row">
            <label htmlFor="open-as-tabs">Open projects as tabs</label>
            <input
              id="open-as-tabs"
              type="checkbox"
              checked={openProjectsAsTabs}
              onChange={(e) => {
                const v = e.target.checked;
                useApp.getState().setLayoutHydrated(true);
                setOpenProjectsAsTabs(v);
                void window.airlock.prefsSet({ openProjectsAsTabs: v });
              }}
            />
          </div>
          <p className="settings-note">
            On: opening a folder adds it as a tab in this window, so you can
            switch between projects without juggling windows. Off: each project
            opens on its own and "New Window" gives you a separate window per
            project. The agent always operates on the project you are currently
            viewing.
          </p>
          <div className="settings-row">
            <label htmlFor="show-running-notice">
              Show running-process notice
            </label>
            <input
              id="show-running-notice"
              type="checkbox"
              checked={showRunningProcessNotice}
              onChange={(e) => {
                const v = e.target.checked;
                useApp.getState().setLayoutHydrated(true);
                setShowRunningProcessNotice(v);
                void window.airlock.prefsSet({ showRunningProcessNotice: v });
              }}
            />
          </div>
          <p className="settings-note">
            When opening a folder keeps a terminal that has a running session
            (e.g. <code>claude</code>), show a reminder that the session stays
            in its old directory and must be restarted in the new folder to get
            its context.
          </p>
          <div className="settings-sublabel">Sidebar position</div>
          <label className="settings-row">
            <input
              type="radio"
              name="sidebar-position"
              checked={sidebarPosition === "left"}
              onChange={() => choosePosition("left")}
            />
            Left
          </label>
          <label className="settings-row">
            <input
              type="radio"
              name="sidebar-position"
              checked={sidebarPosition === "right"}
              onChange={() => choosePosition("right")}
            />
            Right
          </label>
          <label className="settings-row">
            <input
              type="checkbox"
              checked={sidebarVisible}
              onChange={toggleSidebarVisible}
            />
            Sidebar visible
          </label>
        </section>

        <section className="settings-section">
          <h3>Secrets</h3>
          {root ? (
            <label className="settings-row">
              <input
                type="checkbox"
                checked={config?.injectSecretsIntoTerminal ?? false}
                onChange={toggleInject}
              />
              Inject secrets into terminal
            </label>
          ) : (
            <div className="settings-note">
              Open a folder to manage secrets.
            </div>
          )}
          <div className="settings-row">
            <label htmlFor="clip-clear">
              Clipboard auto-clear (seconds, 0 = never)
            </label>
            <input
              id="clip-clear"
              type="number"
              min={0}
              max={3600}
              value={clipboardClearSeconds}
              onChange={(e) => {
                const n = Math.min(
                  3600,
                  Math.max(0, Math.floor(Number(e.target.value) || 0)),
                );
                useApp.getState().setLayoutHydrated(true);
                setClipboardClearSeconds(n);
                void window.airlock.prefsSet({ clipboardClearSeconds: n });
              }}
            />
          </div>
          <p className="settings-note">
            When you copy a secret, it goes to the system clipboard, which other
            apps — and the terminal agent via <code>pbpaste</code> — can read
            while it is there. airlock clears it after this delay (only if the
            clipboard still holds that secret). A longer delay, or{" "}
            <strong>0 (never)</strong>, is more convenient but leaves the value
            readable for longer. airlock cannot purge a third-party clipboard
            manager's history.
          </p>
        </section>

        <section className="settings-section">
          <h3>Claude</h3>
          <div className="settings-row">
            <label htmlFor="quota-meter">Show Claude usage meter</label>
            <input
              id="quota-meter"
              type="checkbox"
              checked={quotaMeterEnabled}
              onChange={(e) => {
                const v = e.target.checked;
                useApp.getState().setLayoutHydrated(true);
                setQuotaMeterEnabled(v);
                // Drop any cached usage when turning off so re-enabling shows
                // "waiting" rather than flashing stale numbers (main stops the
                // watcher; this clears the renderer's copy).
                if (!v) useApp.setState({ quota: null });
                void window.airlock.prefsSet({ quotaMeter: { enabled: v } });
              }}
            />
          </div>
          <p className="settings-note">
            Shows your Claude subscription usage (5-hour and 7-day limits) and a
            reset countdown in the sidebar. Enabling installs a Claude Code
            status line that AirLock reads; if you already have a custom status
            line, AirLock chains it so your footer is unchanged. Turning this
            off removes it completely.
          </p>
          <div className="settings-row">
            <label htmlFor="claude-auto-start">
              Auto-start Claude in terminals
            </label>
            <select
              id="claude-auto-start"
              value={claudeAutoStart}
              onChange={(e) => {
                const v = e.target.value as ClaudeAutoStart;
                useApp.getState().setLayoutHydrated(true);
                setClaudeAutoStart(v);
                void window.airlock.prefsSet({ claudeAutoStart: v });
              }}
            >
              <option value="first">First terminal per tab</option>
              <option value="every">Every terminal</option>
              <option value="off">Off</option>
            </select>
          </div>
          <p className="settings-note">
            Runs `claude` automatically in new terminals of project tabs. "First
            terminal per tab" starts one session per project; extra terminals
            open as plain shells. Blank tabs are never auto-started.
          </p>
        </section>

        <section className="settings-section">
          <h3>Agent</h3>
          <AgentSection />
        </section>

        <div className="settings-footer-note">
          More settings arrive with the agent (model, redaction).
        </div>
      </div>
    </div>
  );
}
