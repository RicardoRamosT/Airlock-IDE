import { IMPLICIT_TAB_ID, useApp } from "../store";

/**
 * Kill and replace the active terminal so the next shell picks up newly
 * vaulted secrets. Other terminals keep their env (env applies at spawn).
 *
 * Operates on the ACTIVE tab's terminal slice (the focused project). addTerminal
 * also targets the active tab, so the replacement lands in the same project.
 */
export function restartActiveTerminal(): void {
  const s = useApp.getState();
  const tabId = s.activeTabId ?? IMPLICIT_TAB_ID;
  const tt = s.tabTerminals[tabId];
  if (!tt) return;
  const active = tt.terminals.find((t) => t.id === tt.activeTerminalId);
  if (active?.ptyId) window.airlock.ptyKill(active.ptyId);
  if (active) s.removeTerminal(active.id);
  const after = useApp.getState().tabTerminals[tabId];
  if (after && after.terminals.length > 0) s.addTerminal();
}
