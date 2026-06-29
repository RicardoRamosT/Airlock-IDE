import { useApp } from "../store";

// Open a dedicated dev terminal in the focused project, queue the command (the
// same pending-command path Install buttons use), wait for the pty to adopt,
// then register it with main so the manager owns port discovery + lifecycle.
export async function startManagedDevTerminal(
  command: string,
  startedBy: "user" | "agent",
): Promise<void> {
  const s = useApp.getState();
  const tabId = s.activeTabId;
  const root = s.tabState[tabId]?.root ?? null;
  if (!root) return;
  const termId = s.addTerminal(tabId);
  useApp.setState((st) => ({
    pendingTerminalCommands: {
      ...st.pendingTerminalCommands,
      [termId]: `${command}\n`,
    },
  }));
  s.switchTab(tabId);
  s.setActiveTerminal(termId, tabId);
  // Wait (bounded) for TerminalPane to adopt the pty and store its ptyId.
  const ptyId = await waitForPtyId(termId, 5000);
  if (ptyId)
    await window.airlock.devServerRegister(
      root,
      termId,
      ptyId,
      command,
      startedBy,
    );
}

function waitForPtyId(
  termId: string,
  timeoutMs: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const find = (): string | null => {
      for (const tt of Object.values(useApp.getState().tabTerminals))
        for (const t of tt.terminals) if (t.id === termId) return t.ptyId;
      return null;
    };
    const existing = find();
    if (existing) return resolve(existing);
    const started = performance.now();
    const unsub = useApp.subscribe(() => {
      const id = find();
      if (id) {
        unsub();
        resolve(id);
      } else if (performance.now() - started > timeoutMs) {
        unsub();
        resolve(null);
      }
    });
  });
}
