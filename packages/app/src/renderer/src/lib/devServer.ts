import { useApp } from "../store";

// Open a dedicated dev terminal in `tabId` -- the caller's project tab, which
// the command handler resolves through ideScope rather than taking whatever is
// focused -- queue the command (the same pending-command path Install buttons
// use), wait for the pty to adopt, then register it with main so the manager
// owns port discovery + lifecycle.
export async function startManagedDevTerminal(
  tabId: string | null,
  command: string,
  startedBy: "user" | "agent",
): Promise<void> {
  const s = useApp.getState();
  const root = tabId ? (s.tabState[tabId]?.root ?? null) : null;
  // Thrown, so main reports it to the caller. A silent return read as a
  // successful start with nothing running.
  if (!tabId || !root)
    throw new Error("No project tab to start the dev server in");
  const termId = s.addTerminal(tabId);
  useApp.setState((st) => ({
    pendingTerminalCommands: {
      ...st.pendingTerminalCommands,
      [termId]: `${command}\n`,
    },
  }));
  // Shown within ITS OWN tab, and never switchTab: when this project is not the
  // one on screen, an agent starting its server must not take the screen.
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
