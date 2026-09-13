import { useEffect, useState } from "react";
import type { ClaudeAutoStart, Section } from "../../../shared/ipc";
import { useProjectTab } from "../lib/projectPane";
import { BUILTIN_SECTION_META as SECTION_META } from "../lib/sections";
import { useApp } from "../store";
import { AboutSection } from "./AboutSection";
import { AgentSection } from "./AgentSection";

// Settings categories shown as a left nav rail; the content pane renders only
// the selected one (no more one-long-scroll). Module-level so the union type is
// derivable and the array isn't rebuilt per render.
// The 24 hours, as VALUES: mapping over an index would make the key an
// array index, which is not a stable identity.
const HOURS_OF_DAY = Array.from({ length: 24 }, (_, i) => i);

const CATEGORIES = [
  { id: "appearance", label: "Appearance", icon: "symbol-color" },
  { id: "layout", label: "Layout", icon: "layout" },
  { id: "terminal", label: "Terminal", icon: "terminal" },
  { id: "claude", label: "Claude", icon: "hubot" },
  { id: "secrets", label: "Secrets", icon: "lock" },
  { id: "agent", label: "Agent", icon: "law" },
  { id: "about", label: "About", icon: "info" },
] as const;
type SettingsCategory = (typeof CATEGORIES)[number]["id"];

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
  const sectionVisibility = useApp((s) => s.sectionVisibility);
  const setSectionVisibility = useApp((s) => s.setSectionVisibility);
  const clipboardClearSeconds = useApp((s) => s.clipboardClearSeconds);
  const setClipboardClearSeconds = useApp((s) => s.setClipboardClearSeconds);
  const openProjectsAsTabs = useApp((s) => s.openProjectsAsTabs);
  const setOpenProjectsAsTabs = useApp((s) => s.setOpenProjectsAsTabs);
  const showRunningProcessNotice = useApp((s) => s.showRunningProcessNotice);
  const setShowRunningProcessNotice = useApp(
    (s) => s.setShowRunningProcessNotice,
  );
  const atlas = useApp((s) => s.atlas);
  // Which credential actually pays for Atlas. Read from main, where the
  // environment is visible.
  const [atlasState, setAtlasState] = useState<{
    mode: "api-key" | "auth-token" | "subscription";
  } | null>(null);
  useEffect(() => {
    let alive = true;
    window.airlock
      ?.atlasState()
      .then((v) => {
        if (alive) setAtlasState({ mode: v.mode });
      })
      .catch(() => {
        if (alive) setAtlasState(null);
      });
    return () => {
      alive = false;
    };
  }, []);
  const setAtlas = useApp((s) => s.setAtlas);
  const quotaMeterEnabled = useApp((s) => s.quotaMeterEnabled);
  const setQuotaMeterEnabled = useApp((s) => s.setQuotaMeterEnabled);
  const dockStatusEnabled = useApp((s) => s.dockStatusEnabled);
  const setDockStatusEnabled = useApp((s) => s.setDockStatusEnabled);
  const runAppSkillEnabled = useApp((s) => s.runAppSkillEnabled);
  const setRunAppSkillEnabled = useApp((s) => s.setRunAppSkillEnabled);
  const selfVerifyEnabled = useApp((s) => s.selfVerifyEnabled);
  const setSelfVerifyEnabled = useApp((s) => s.setSelfVerifyEnabled);
  const claudeAutoStart = useApp((s) => s.claudeAutoStart);
  const setClaudeAutoStart = useApp((s) => s.setClaudeAutoStart);
  const claudeSkipPermissions = useApp((s) => s.claudeSkipPermissions);
  const setClaudeSkipPermissions = useApp((s) => s.setClaudeSkipPermissions);
  const askBeforeTerminalInput = useApp((s) => s.askBeforeTerminalInput);
  const setAskBeforeTerminalInput = useApp((s) => s.setAskBeforeTerminalInput);
  const restoreSession = useApp((s) => s.restoreSession);
  const setRestoreSession = useApp((s) => s.setRestoreSession);
  const defaultTerminal = useApp((s) => s.defaultTerminal);
  const setDefaultTerminal = useApp((s) => s.setDefaultTerminal);
  // Per-project bits are scoped to the pane's tab; the app-global controls above
  // stay app-global and are deliberately NOT tied to a tab.
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const config = useApp((s) => s.tabState[tabId]?.config ?? null);
  const setConfig = useApp((s) => s.setConfig);

  const [category, setCategory] = useState<SettingsCategory>("appearance");

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

  const [externalTerminals, setExternalTerminals] = useState<
    { id: string; name: string }[]
  >([]);
  useEffect(() => {
    void window.airlock
      .listExternalTerminals()
      .then(setExternalTerminals)
      .catch(console.error);
  }, []);

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

  const toggleSection = (id: Section) => {
    useApp.getState().setLayoutHydrated(true);
    const next = { ...sectionVisibility, [id]: !sectionVisibility[id] };
    setSectionVisibility(next);
    void window.airlock.prefsSet({ sectionVisibility: next });
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

      <div className="settings-main">
        <nav className="settings-nav">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`settings-nav-item${category === c.id ? " active" : ""}`}
              onClick={() => setCategory(c.id)}
            >
              <i className={`codicon codicon-${c.icon}`} />
              {c.label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {category === "appearance" && (
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
          )}

          {category === "layout" && (
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
                switch between projects without juggling windows. Off: each
                project opens on its own and "New Window" gives you a separate
                window per project. Either way you can drag a project tab out of
                the window to give it its own — its terminals keep running — or
                drop it onto another window to merge it back in. The agent
                always operates on the project you are currently viewing.
              </p>

              <div className="settings-group">
                <div className="settings-group-title">Sidebar</div>
                <div className="settings-row">
                  <span>Position</span>
                  <div className="settings-choice">
                    <label>
                      <input
                        type="radio"
                        name="sidebar-position"
                        checked={sidebarPosition === "left"}
                        onChange={() => choosePosition("left")}
                      />
                      Left
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="sidebar-position"
                        checked={sidebarPosition === "right"}
                        onChange={() => choosePosition("right")}
                      />
                      Right
                    </label>
                  </div>
                </div>
                <label className="settings-row">
                  <span>Show the sidebar</span>
                  <input
                    type="checkbox"
                    checked={sidebarVisible}
                    onChange={toggleSidebarVisible}
                  />
                </label>
              </div>

              <div className="settings-group">
                <div className="settings-group-title">Sidebar sections</div>
                <p className="settings-note">
                  Which sections appear on the activity rail. You can also
                  right-click any rail icon to hide that section.
                </p>
                {/* Two columns: ten full-width rows buried the settings above them. */}
                <div className="settings-grid">
                  {SECTION_META.map((s) => (
                    /* Control first here (unlike the rows above): in a grid it
                       keeps the toggles on one vertical axis regardless of how
                       long each section name is. */
                    <label key={s.id} className="settings-row">
                      <input
                        type="checkbox"
                        checked={!!sectionVisibility[s.id]}
                        onChange={() => toggleSection(s.id)}
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>
            </section>
          )}

          {category === "terminal" && (
            <section className="settings-section">
              <h3>Terminal</h3>
              <div className="settings-row">
                <label htmlFor="default-terminal">Default terminal</label>
                <select
                  id="default-terminal"
                  value={defaultTerminal}
                  onChange={(e) => {
                    const v = e.target.value;
                    useApp.getState().setLayoutHydrated(true);
                    setDefaultTerminal(v);
                    void window.airlock.prefsSet({ defaultTerminal: v });
                  }}
                >
                  <option value="airlock">AirLock integrated terminal</option>
                  {externalTerminals.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="settings-note">
                Choose where new terminals open. An external app launches at the
                project folder; note that Claude auto-start, in-app tabs/splits,
                and terminal-tail tools only apply to the integrated terminal.
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
                Runs `claude` automatically in new terminals of project tabs.
                "First terminal per tab" starts one session per project; extra
                terminals open as plain shells. Blank tabs are never
                auto-started.
              </p>
              {/* A modifier of the setting above, so it sits with it rather
                  than in its own group. */}
              <div className="settings-row">
                <label htmlFor="claude-skip-permissions">
                  Skip permission prompts
                </label>
                <input
                  id="claude-skip-permissions"
                  type="checkbox"
                  checked={claudeSkipPermissions}
                  disabled={claudeAutoStart === "off"}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setClaudeSkipPermissions(v);
                    void window.airlock.prefsSet({ claudeSkipPermissions: v });
                  }}
                />
              </div>
              <p className="settings-note">
                Starts auto-started sessions with
                `--dangerously-skip-permissions`, so Claude never asks before
                running a command. Note that AirLock also injects this project's
                vaulted secrets into every terminal, so a session started this
                way has no prompts AND real credentials in its environment.
              </p>
              {/* Sits with the permission controls above rather than under
                  Agent: it is about how much Claude asks, not about the
                  command policy. */}
              <div className="settings-row">
                <label htmlFor="ask-before-terminal-input">
                  Ask before Claude types into a terminal
                </label>
                <input
                  id="ask-before-terminal-input"
                  type="checkbox"
                  checked={askBeforeTerminalInput}
                  onChange={(e) => {
                    const v = e.target.checked;
                    useApp.getState().setLayoutHydrated(true);
                    setAskBeforeTerminalInput(v);
                    void window.airlock.prefsSet({ askBeforeTerminalInput: v });
                  }}
                />
              </div>
              <p className="settings-note">
                Off by default: Claude already runs commands in your project, so
                a prompt before it types into a terminal it is already driving
                is friction rather than protection. Turn it on to approve the
                FIRST send to each terminal; approve once and later sends to
                that terminal go through for the rest of the session. An
                approval you never answer times out after five minutes and the
                input is not sent.
              </p>
              {/* Lives here, not under Layout: it is about a terminal session
                  surviving a folder change, not about window arrangement. */}
              <div className="settings-row">
                <label htmlFor="show-running-notice">
                  Warn when a session keeps its old folder
                </label>
                <input
                  id="show-running-notice"
                  type="checkbox"
                  checked={showRunningProcessNotice}
                  onChange={(e) => {
                    const v = e.target.checked;
                    useApp.getState().setLayoutHydrated(true);
                    setShowRunningProcessNotice(v);
                    void window.airlock.prefsSet({
                      showRunningProcessNotice: v,
                    });
                  }}
                />
              </div>
              <p className="settings-note">
                When opening a folder into a tab whose terminal is busy (e.g. a
                running <code>claude</code>), AirLock keeps that session alive —
                but it stays in the old directory. This shows a reminder to
                restart it in the new folder so it picks up the right context.
              </p>
            </section>
          )}

          {category === "claude" && (
            <section className="settings-section">
              <h3>Atlas</h3>
              <div className="settings-row">
                <label htmlFor="atlas-enabled">Atlas</label>
                <select
                  id="atlas-enabled"
                  className="sb-control"
                  value={atlas.enabled ? "on" : "off"}
                  onChange={(e) => {
                    const next = { ...atlas, enabled: e.target.value === "on" };
                    setAtlas(next);
                    void window.airlock.prefsSet({ atlas: next });
                  }}
                >
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </div>
              <p className="settings-note">
                Atlas is your project administrator: it reads every repository
                you have, writes a short debrief each day, and answers questions
                about what to work on. In AirLock it lives in the sidebar, next
                to Files and Git. The macOS menu bar item is optional and stays
                reachable even when AirLock is not in front.
              </p>
              <div className="settings-row">
                <span className="settings-label">Paying with</span>
                <span className="settings-value">
                  {atlasState === null
                    ? "Checking\u2026"
                    : atlasState.mode === "subscription"
                      ? "Your Claude plan"
                      : atlasState.mode === "api-key"
                        ? "An Anthropic API key (ANTHROPIC_API_KEY)"
                        : "An Anthropic auth token (ANTHROPIC_AUTH_TOKEN)"}
                </span>
              </div>
              <p className="settings-note">
                {atlasState === null
                  ? null
                  : atlasState.mode === "subscription"
                    ? "No API key is set on this machine, so Atlas runs on your Claude subscription and costs usage quota rather than money. Nothing to add."
                    : "That credential is read from your environment, so Atlas bills your API account for every debrief and reply. To move Atlas onto your Claude plan instead, unset it in your shell and restart AirLock."}
              </p>
              <p className="settings-note">
                The debrief hour and where Atlas appears now live in Atlas
                itself, under the &#8943; menu &#8250; Atlas settings, along
                with which projects it covers.
              </p>
            </section>
          )}
          {category === "claude" && (
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
                    // "waiting" rather than flashing stale numbers (main stops
                    // the watcher; this clears the renderer's copy).
                    if (!v) useApp.setState({ quota: null });
                    void window.airlock.prefsSet({
                      quotaMeter: { enabled: v },
                    });
                  }}
                />
              </div>
              <p className="settings-note">
                Shows your Claude subscription usage (5-hour and 7-day limits)
                as two gauges either side of the window title, so it stays
                visible even with the sidebar collapsed; click one for usage
                details. Enabling installs a Claude Code status line that
                AirLock reads; if you already have a custom status line, AirLock
                chains it so your footer is unchanged. Turning this off removes
                it completely.
              </p>
              <div className="settings-row">
                <label htmlFor="dock-status">
                  Show Claude activity on the app icon (macOS)
                </label>
                <input
                  id="dock-status"
                  type="checkbox"
                  checked={dockStatusEnabled}
                  onChange={(e) => {
                    const v = e.target.checked;
                    useApp.getState().setLayoutHydrated(true);
                    setDockStatusEnabled(v);
                    void window.airlock.prefsSet({
                      dockStatus: { enabled: v },
                    });
                  }}
                />
              </div>
              <p className="settings-note">
                Colors the dock icon from Claude's own signals: yellow while a
                session is working, green when one finishes or needs you,
                nothing when idle. Enabling installs AirLock-labeled hooks into{" "}
                <code>~/.claude/settings.json</code> (any Claude session on this
                Mac); turning it off removes them completely.
              </p>
              <div className="settings-row">
                <label htmlFor="self-verify">
                  Let Claude verify AirLock (self-test tools)
                </label>
                <input
                  id="self-verify"
                  type="checkbox"
                  checked={selfVerifyEnabled}
                  onChange={(e) => {
                    const v = e.target.checked;
                    useApp.getState().setLayoutHydrated(true);
                    setSelfVerifyEnabled(v);
                    void window.airlock.prefsSet({
                      selfVerify: { enabled: v },
                    });
                  }}
                />
              </div>
              <p className="settings-note">
                Installs an <code>airlock-verify</code> skill and lets the
                Claude you run inside AirLock drive the app, read its debug
                event log, screenshot the UI, and toggle feature settings to
                verify features end-to-end. Off by default. Screenshots can
                capture whatever is on screen (including a revealed secret);
                Claude can never change security settings.
              </p>
              <div className="settings-row">
                <label htmlFor="run-app-skill">
                  Route "run the app" to the managed dev server
                </label>
                <input
                  id="run-app-skill"
                  type="checkbox"
                  checked={runAppSkillEnabled}
                  onChange={(e) => {
                    const v = e.target.checked;
                    useApp.getState().setLayoutHydrated(true);
                    setRunAppSkillEnabled(v);
                    void window.airlock.prefsSet({
                      runAppSkill: { enabled: v },
                    });
                  }}
                />
              </div>
              <div className="settings-row">
                <label htmlFor="restore-session">
                  Restore previous session
                </label>
                <input
                  id="restore-session"
                  type="checkbox"
                  checked={restoreSession}
                  onChange={(e) => {
                    const v = e.target.checked;
                    useApp.getState().setLayoutHydrated(true);
                    setRestoreSession(v);
                    void window.airlock.prefsSet({ restoreSession: v });
                  }}
                />
              </div>
              <p className="settings-note">
                Reopens your projects and resumes each one's Claude chat (claude
                --continue) when AirLock starts.
              </p>
            </section>
          )}

          {category === "secrets" && (
            <section className="settings-section">
              <h3>Secrets</h3>
              {root ? (
                <label className="settings-row">
                  <input
                    type="checkbox"
                    checked={config?.injectSecretsIntoTerminal ?? false}
                    onChange={toggleInject}
                  />
                  Make secrets available in new terminals
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
                When you copy a secret, it goes to the system clipboard, which
                other apps — and the terminal agent via <code>pbpaste</code> —
                can read while it is there. airlock clears it after this delay
                (only if the clipboard still holds that secret). A longer delay,
                or <strong>0 (never)</strong>, is more convenient but leaves the
                value readable for longer. airlock cannot purge a third-party
                clipboard manager's history.
              </p>
            </section>
          )}

          {category === "agent" && (
            <section className="settings-section">
              <h3>Agent</h3>
              <AgentSection />
            </section>
          )}

          {category === "about" && <AboutSection />}
        </div>
      </div>
    </div>
  );
}
