import { useEffect } from "react";
import { useApp } from "../store";

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
  const root = useApp((s) => s.root);
  const config = useApp((s) => s.config);
  const setConfig = useApp((s) => s.setConfig);

  // Populate config when a folder is open but the store has not loaded it yet
  // (e.g. the user never opened the secrets section). No-op when already set.
  useEffect(() => {
    if (root && !config) {
      window.airlock.configGet().then(setConfig).catch(console.error);
    }
  }, [root, config, setConfig]);

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
    const next = await window.airlock.configSet({
      injectSecretsIntoTerminal: !(config?.injectSecretsIntoTerminal ?? false),
    });
    setConfig(next);
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

        <div className="settings-footer-note">
          More settings arrive with the agent (model, redaction).
        </div>
      </div>
    </div>
  );
}
