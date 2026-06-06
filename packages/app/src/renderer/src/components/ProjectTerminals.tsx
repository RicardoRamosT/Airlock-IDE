import { useEffect, useRef } from "react";
import { EMPTY_TAB_TERMINALS, useApp } from "../store";
import { TerminalPane } from "./TerminalPane";
import { TerminalTabs } from "./TerminalTabs";

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
  const splitTerminalId = useApp(
    (s) => (s.tabTerminals[tabId] ?? EMPTY_TAB_TERMINALS).splitTerminalId,
  );
  const addTerminal = useApp((s) => s.addTerminal);
  const activeTabId = useApp((s) => s.activeTabId);
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
  // addTerminal acts on the ACTIVE tab, so only respawn for the tab that is
  // currently active (an empty background tab must not steal the respawn and
  // spawn into itself). A blank tab is a real tab, so it matches activeTabId
  // directly when it is the active one.
  const isActive = tabId === activeTabId;
  const spawningDefault = useRef(false);
  useEffect(() => {
    if (terminals.length > 0) {
      spawningDefault.current = false;
      return;
    }
    if (!isActive) return;
    if (spawningDefault.current) return;
    spawningDefault.current = true;
    addTerminal();
  }, [terminals.length, addTerminal, isActive]);

  const visible = (id: string) =>
    id === activeTerminalId || id === splitTerminalId;

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

  return (
    <div className="terminal-manager">
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
      <TerminalTabs tabId={tabId} />
      <div className={`terminal-panes${splitTerminalId ? " split" : ""}`}>
        {terminals.map((t) => (
          <div
            key={t.id}
            className={`terminal-pane-slot${visible(t.id) ? "" : " hidden"}`}
          >
            <TerminalPane terminalId={t.id} />
          </div>
        ))}
      </div>
    </div>
  );
}
