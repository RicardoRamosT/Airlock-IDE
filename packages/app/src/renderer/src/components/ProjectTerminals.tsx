import { useEffect, useRef } from "react";
import { EMPTY_TAB_TERMINALS, isVisibleTab, useApp } from "../store";
import { TerminalPane } from "./TerminalPane";

// One project's terminal subtree (the old TerminalManager body), scoped to a
// single tab's `tabTerminals[tabId]`. TerminalManager renders one of these per
// tab and keeps them ALL mounted, hiding inactive ones via CSS so their ptys
// stay alive across tab switches (a pty dies only when its TerminalPane
// unmounts). The auto-respawn-when-empty effect keys on THIS tab's terminal
// list, so a fresh tab gets exactly one terminal and a backgrounded empty tab
// does not respawn spuriously.
export function ProjectTerminals({ tabId }: { tabId: string }) {
  // Each selector reads this tab's slice. The empty fallback is a stable
  // reference so an absent tab id does not churn the selector identity.
  const terminals = useApp(
    (s) => (s.tabTerminals[tabId] ?? EMPTY_TAB_TERMINALS).terminals,
  );
  const activeTerminalId = useApp(
    (s) => (s.tabTerminals[tabId] ?? EMPTY_TAB_TERMINALS).activeTerminalId,
  );
  // Which terminals are on screen is driven by the unified main-pane model: the
  // PRIMARY pane shows the active terminal (when mainPrimary==="terminal") and
  // the SECONDARY pane shows mainSecondary's terminal (when it is one). Either,
  // both, or neither -> 0/1/2 terminal panes.
  const mainPrimary = useApp(
    (s) => s.tabState[tabId]?.mainPrimary ?? "terminal",
  );
  const mainSecondary = useApp((s) => s.tabState[tabId]?.mainSecondary ?? null);
  const addTerminal = useApp((s) => s.addTerminal);
  const activeTabId = useApp((s) => s.activeTabId);
  const switchTab = useApp((s) => s.switchTab);
  // Visible = actually rendered on screen (active tab, or either pane of a
  // showing split). The respawn-when-empty below keys on this, not on activeness,
  // so a freshly-split secondary pane (visible but != activeTabId) still spawns
  // its first terminal. Shared with the status-glow logic (one definition).
  const isVisible = useApp((s) => isVisibleTab(s.activeTabId, s.split, tabId));
  // Running-process notice (T3): shown on the folder-rooted terminal that was
  // spawned alongside a KEPT busy terminal when a folder was opened into this
  // (blank) tab. runningNotice.terminalId is that new terminal's renderer id.
  const runningNotice = useApp((s) => s.runningNotice);
  const showRunningProcessNotice = useApp((s) => s.showRunningProcessNotice);
  const root = useApp((s) => s.root);

  // Always keep at least one terminal alive in THIS tab. The ref guards against
  // React 19 StrictMode replaying this mount effect with a stale (length === 0)
  // closure, which would otherwise spawn two default tabs (and two PTYs) on
  // boot. The guard is armed only while the list is empty and cleared once a
  // terminal exists, so killing the last tab still respawns a fresh one.
  //
  // Respawn into THIS tab (addTerminal takes the explicit tabId), but only while
  // the pane is VISIBLE -- a backgrounded empty tab must not eagerly spawn a pty
  // it isn't showing (lazy until shown). Visibility, not activeness, is the gate:
  // a freshly-split blank SECONDARY pane is visible yet never the active tab, so
  // an activeness gate would leave it permanently terminal-less.
  const isActive = tabId === activeTabId;
  const spawningDefault = useRef(false);
  useEffect(() => {
    if (terminals.length > 0) {
      spawningDefault.current = false;
      return;
    }
    if (!isVisible) return;
    if (spawningDefault.current) return;
    spawningDefault.current = true;
    addTerminal(tabId);
  }, [terminals.length, addTerminal, isVisible, tabId]);

  // On screen = the shown scene's pane(s): the primary terminal (active) and/or
  // the secondary when it is a terminal. (The derived mainPrimary/mainSecondary
  // already reflect the focused scene.)
  const visible = (id: string) =>
    (mainPrimary === "terminal" && id === activeTerminalId) ||
    (mainSecondary?.kind === "terminal" && id === mainSecondary.id);
  const visibleCount = terminals.filter((t) => visible(t.id)).length;

  // The notice belongs to THIS tab only when its terminal is one of ours, and
  // is gated on being the active tab + the pref still enabled. Resolving the
  // owning terminal here also gives us its ptyId for the "Start Claude here"
  // write (a clean existing API; no new IPC needed).
  const noticeTerminal =
    isActive && showRunningProcessNotice && runningNotice
      ? (terminals.find((t) => t.id === runningNotice.terminalId) ?? null)
      : null;
  // basename of the active tab's root for the message; root is non-null whenever
  // a notice exists (it is set only after a folder is attached to this tab).
  const folder = root ? (root.split("/").filter(Boolean).pop() ?? root) : "";

  const dismissNotice = () => {
    useApp.getState().setRunningNotice(null);
  };
  const dismissForever = () => {
    // Mark hydrated first so an in-flight startup prefsGet cannot clobber this
    // persisted choice (same race the other persisted toggles guard against).
    useApp.getState().setLayoutHydrated(true);
    useApp.getState().setShowRunningProcessNotice(false);
    void window.airlock.prefsSet({ showRunningProcessNotice: false });
    useApp.getState().setRunningNotice(null);
  };
  const startClaudeHere = () => {
    if (noticeTerminal?.ptyId) {
      window.airlock.ptyInput(noticeTerminal.ptyId, "claude\n");
    }
    useApp.getState().setRunningNotice(null);
  };

  // Clicking anywhere in this pane's terminal area focuses the pane. ProjectPane
  // already does this for its sidebar/viewer, but the terminals render through a
  // PORTAL whose React events bubble to TerminalManager (not ProjectPane), so a
  // click in pane B's terminal would otherwise leave pane A active -- the agent
  // root, title, and per-pane terminal controls would target the wrong pane.
  // switchTab no-ops when this tab is already active; the terminal host nodes are
  // stable, so this re-render does not remount/blur xterm.
  return (
    <div
      className="terminal-manager"
      onMouseDownCapture={() => switchTab(tabId)}
    >
      {noticeTerminal && (
        <div className="terminal-notice" role="status">
          <span className="terminal-notice-text">
            Claude is still running in its previous directory. This terminal is
            in <strong>{folder}</strong>. Run <code>claude</code> here to give
            it this folder's context.
          </span>
          <span className="terminal-notice-actions">
            <button
              type="button"
              className="terminal-notice-btn"
              onClick={startClaudeHere}
            >
              Start Claude here
            </button>
            <button
              type="button"
              className="terminal-notice-btn"
              onClick={dismissForever}
            >
              Do not show again
            </button>
            <button
              type="button"
              className="terminal-notice-close"
              title="Dismiss"
              aria-label="Dismiss"
              onClick={dismissNotice}
            >
              <i className="codicon codicon-close" />
            </button>
          </span>
        </div>
      )}
      <div className={`terminal-panes${visibleCount > 1 ? " split" : ""}`}>
        {terminals.map((t) => (
          <div
            key={t.id}
            // `active` marks the tab's active terminal so the focused-pane
            // glow can persist on it while the keyboard is in the sidebar.
            className={`terminal-pane-slot${visible(t.id) ? "" : " hidden"}${
              t.id === activeTerminalId ? " active" : ""
            }`}
          >
            <TerminalPane terminalId={t.id} />
          </div>
        ))}
      </div>
    </div>
  );
}
