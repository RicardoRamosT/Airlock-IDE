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
  if (after && after.terminals.length > 0) s.addTerminal(tid);
}
