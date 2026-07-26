import type { MovingTab } from "../../../shared/ipc";
import type { AppState } from "../store";

// Which strip entries may leave their window. A "pair" tab covers TWO projects
// (moving both doubles the state surface for a rare case), and the page-tabs
// (Settings/Usage) are app chrome that is already app-global -- neither moves.
export function isMovableKey(key: string): boolean {
  return key !== "pair" && !key.startsWith("page:");
}

// Serialize one tab for transport to another window. Returns null for an unknown
// tab. The pane scene rides along as an opaque blob -- main never reads it.
export function buildMovingTab(s: AppState, tabId: string): MovingTab | null {
  const tab = s.tabs.find((t) => t.id === tabId);
  if (!tab) return null;
  const tt = s.tabTerminals[tabId];
  return {
    root: tab.root,
    label: s.tabRenames[tabId] ?? null,
    terminals: (tt?.terminals ?? []).map((t) => ({
      id: t.id,
      ptyId: t.ptyId,
      title: t.title,
    })),
    activeTerminalId: tt?.activeTerminalId ?? null,
    state: s.tabState[tabId] ?? null,
  };
}
