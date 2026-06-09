import { useApp } from "../store";

/**
 * Kill and replace a tab's active terminal so the next shell picks up newly
 * vaulted secrets. Other terminals keep their env (env applies at spawn).
 *
 * Operates on the given tab's terminal slice (defaulting to the active tab).
 * SecretsSection passes ITS pane's tabId so a "restart" in a non-focused split
 * pane replaces that pane's terminal, not the focused one.
 */
export function restartActiveTerminal(tabId?: string): void {
  const s = useApp.getState();
  const tid = tabId ?? s.activeTabId;
  const tt = s.tabTerminals[tid];
  if (!tt) return;
  const active = tt.terminals.find((t) => t.id === tt.activeTerminalId);
  if (active?.ptyId) window.airlock.ptyKill(active.ptyId);
  if (active) s.removeTerminal(active.id);
  const after = useApp.getState().tabTerminals[tid];
  // Replace the killed terminal whenever the tab slice still exists. removeTerminal
  // KEEPS the slice but empties `terminals`, so the old `length > 0` guard skipped
  // the single-terminal case -- leaving a non-visible tab with no terminal at all
  // (a visible tab was only saved by ProjectTerminals' auto-respawn). (audit PB-H7)
  if (after) s.addTerminal(tid);
}
