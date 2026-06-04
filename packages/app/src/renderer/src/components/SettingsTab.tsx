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
        </section>

        <div className="settings-footer-note">
          More settings arrive with the agent (model, redaction).
        </div>
      </div>
    </div>
  );
}
