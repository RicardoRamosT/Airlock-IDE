import { useEffect } from "react";
import type { AgentCommand, TabsSnapshot } from "../../../shared/ipc";
import { useApp } from "../store";

// Renderer-side handler for the agent IDE-control commands (the main->renderer
// round-trip in main/agent-commands.ts, mirroring useMenuActions). Mounted once
// in App.tsx: it subscribes to agent:command, runs the matching store action for
// each command, and replies with a FRESH TabsSnapshot via agentCommandResult.
//
// THE INVARIANT: the reply is layout METADATA only -- tab names + terminal titles
// + roots + the split pair. NO secret value, env value, or terminal output ever
// goes into the snapshot, so these tools never widen the no-secret-value surface.

// Tab display name: the folder basename, or "New Tab" for a blank tab (mirrors
// ProjectTabs' tabLabel).
const tabName = (root: string | null): string =>
  root ? (root.split("/").pop() ?? root) : "New Tab";

// Build the current layout metadata from the store. One entry per open tab (its
// id, name, root, focused/in-split flags, and terminals as {id,title}) plus the
// split pair. Read off useApp.getState() so it reflects the just-applied action.
function buildSnapshot(): TabsSnapshot {
  const s = useApp.getState();
  const { tabs, activeTabId, split, tabTerminals } = s;
  return {
    tabs: tabs.map((t) => ({
      id: t.id,
      name: tabName(t.root),
      root: t.root,
      focused: t.id === activeTabId,
      inSplit: !!split && (split.a === t.id || split.b === t.id),
      terminals: (tabTerminals[t.id]?.terminals ?? []).map((term) => ({
        id: term.id,
        title: term.title,
      })),
    })),
    split,
  };
}

// Perform one IDE-control command against the store. open_tab is async (it opens
// the folder main-side first via workspaceOpen, so main's root + recents + the
// MCP registration follow), so this is async and the caller replies after it.
async function applyCommand(cmd: AgentCommand): Promise<void> {
  const s = useApp.getState();
  switch (cmd.type) {
    case "list_tabs":
      // Read-only: no action, just the snapshot the caller builds afterward.
      break;
    case "open_tab":
      if (cmd.path) {
        // Open the folder main-side (sets the window root + recents + registers
        // the MCP server for that project) BEFORE adding the tab, mirroring the
        // open-recent menu flow; then add it as a NEW tab in this window.
        await window.airlock.workspaceOpen(cmd.path);
        useApp.getState().openProject(cmd.path);
      } else {
        s.openBlankTab();
      }
      break;
    case "close_tab":
      s.closeTab(cmd.tabId);
      break;
    case "switch_tab":
      s.switchTab(cmd.tabId);
      break;
    case "split_view":
      if (cmd.tabId) s.splitActiveWith(cmd.tabId);
      else s.toggleProjectSplit();
      break;
    case "open_terminal":
      // addTerminal targets the ACTIVE tab, so focus the requested tab first when
      // it is not already active; then add the terminal there.
      if (cmd.tabId && cmd.tabId !== s.activeTabId) s.switchTab(cmd.tabId);
      useApp.getState().addTerminal();
      break;
    case "close_terminal":
      s.removeTerminal(cmd.terminalId);
      break;
  }
}

export function useAgentCommands(): void {
  useEffect(() => {
    return window.airlock.onAgentCommand(async ({ id, cmd }) => {
      try {
        await applyCommand(cmd);
        window.airlock.agentCommandResult(id, {
          ok: true,
          data: buildSnapshot(),
        });
      } catch (e) {
        window.airlock.agentCommandResult(id, { ok: false, error: String(e) });
      }
    });
  }, []);
}
