import { useApp } from "../store";

/**
 * Kill and replace the active terminal so the next shell picks up newly
 * vaulted secrets. Other terminals keep their env (env applies at spawn).
 */
export function restartActiveTerminal(): void {
  const { terminals, activeTerminalId, removeTerminal, addTerminal } =
    useApp.getState();
  const active = terminals.find((t) => t.id === activeTerminalId);
  if (active?.ptyId) window.airlock.ptyKill(active.ptyId);
  if (active) removeTerminal(active.id);
  if (useApp.getState().terminals.length > 0) addTerminal();
}
