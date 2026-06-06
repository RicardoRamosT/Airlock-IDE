import { useApp } from "../store";

// Open a folder the user picked. If the active tab already has a project, the
// normal route (new tab / replace) spawns fresh folder-rooted terminals, so just
// delegate. If the active tab is BLANK, attach the folder here and manage the
// terminal so a running session (e.g. claude) is NEVER killed: keep a busy
// terminal + open a folder-rooted one alongside it (flag the notice); for an idle
// terminal, drop it and keep only the fresh folder-rooted one.
export async function openPickedFolder(root: string): Promise<void> {
  const s = useApp.getState();
  const activeId = s.activeTabId;
  const active = s.tabs.find((t) => t.id === activeId);
  if (!active || active.root !== null) {
    s.setRoot(root);
    return;
  }
  const tt = s.tabTerminals[activeId];
  const prevTermId = tt?.activeTerminalId ?? null;
  const prevPty = prevTermId
    ? (tt?.terminals.find((t) => t.id === prevTermId)?.ptyId ?? null)
    : null;
  const busy = prevPty ? await window.airlock.ptyIsBusy(prevPty) : false;

  s.setRoot(root); // blank active -> fillActiveTab (keeps the existing terminals)
  const newTermId = s.addTerminal(); // fresh folder-rooted terminal, now active
  if (busy) {
    s.setRunningNotice({ terminalId: newTermId }); // keep the busy one; notice it
  } else if (prevTermId) {
    s.removeTerminal(prevTermId); // idle scratch shell -> drop it
  }
}
