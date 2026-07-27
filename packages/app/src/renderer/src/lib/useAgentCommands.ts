import { useEffect } from "react";
import type {
  AgentCommand,
  ConnectStarted,
  TabsSnapshot,
} from "../../../shared/ipc";
import { useApp } from "../store";
import { startManagedDevTerminal } from "./devServer";
import { primaryConnectAction, runExtensionAction } from "./extensionActions";

// Renderer-side handler for the agent IDE-control commands (the main->renderer
// round-trip in main/agent-commands.ts, mirroring useMenuActions). Mounted once
// in App.tsx: it subscribes to agent:command, runs the matching store action for
// each command, and replies with a FRESH TabsSnapshot via agentCommandResult.
//
// THE INVARIANT: the reply is layout METADATA only -- tab names + terminal titles
// + roots + the split pair. NO secret value, env value, or terminal output ever
// goes into the snapshot, so these tools never widen the no-secret-value surface.

// Tab display name: the user's custom rename when set, else the folder
// basename, or "New Tab" for a blank tab (mirrors ProjectTabs' display label).
const tabName = (root: string | null): string =>
  root ? (root.split("/").pop() ?? root) : "New Tab";

// Build the current layout metadata from the store. One entry per open tab (its
// id, name, root, focused/in-split flags, and terminals as {id,title}) plus the
// split pair and the IDE page-tab state (Settings/Usage: which are open, which
// is shown). Read off useApp.getState() so it reflects the just-applied action.
function buildSnapshot(): TabsSnapshot {
  const s = useApp.getState();
  const { tabs, activeTabId, split, tabTerminals, tabRenames } = s;
  return {
    tabs: tabs.map((t) => ({
      id: t.id,
      name: tabRenames[t.id] ?? tabName(t.root),
      root: t.root,
      focused: t.id === activeTabId,
      inSplit: !!split && (split.a === t.id || split.b === t.id),
      terminals: (tabTerminals[t.id]?.terminals ?? []).map((term) => ({
        id: term.id,
        // The pty session id (QA 2026-06-11): get_terminal_tail keys on THIS,
        // not the layout id above -- expose both so agents need no translation.
        ptyId: term.ptyId,
        title: term.title,
      })),
    })),
    split,
    appPages: {
      open: [
        ...(s.settingsTabOpen ? (["settings"] as const) : []),
        ...(s.usageTabOpen ? (["usage"] as const) : []),
      ],
      // The Overview page is per-project (not an MCP-openable global page like
      // Settings/Usage), so report it as "no app-page shown" to the agent surface.
      shown: s.appPage === "overview" ? null : s.appPage,
    },
  };
}

// Perform one IDE-control command against the store. open_tab is async (it opens
// the folder main-side first via workspaceOpen, so main's root + recents + the
// MCP registration follow), so this is async and the caller replies after it.
async function applyCommand(cmd: AgentCommand): Promise<ConnectStarted | null> {
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
      // Anchor the LEFT/primary tab explicitly when given, so a focus change
      // (e.g. a human clicking another tab between the agent's commands) cannot
      // silently re-aim the split. switchTab runs synchronously right before
      // splitActiveWith reads the active tab -- no event-loop yield between them,
      // so no click can interleave. Falls back to the focused tab when no anchor.
      if (cmd.anchorTabId && cmd.anchorTabId !== s.activeTabId)
        s.switchTab(cmd.anchorTabId);
      if (cmd.tabId) useApp.getState().splitActiveWith(cmd.tabId);
      else useApp.getState().toggleProjectSplit();
      break;
    case "open_terminal":
      // Focus the requested tab so the new terminal is visible, and pass the
      // tabId to addTerminal so it targets that exact pane (robust even when the
      // tab is the secondary half of a split, where it is visible but not active).
      if (cmd.tabId && cmd.tabId !== s.activeTabId) s.switchTab(cmd.tabId);
      useApp.getState().addTerminal(cmd.tabId);
      break;
    case "close_terminal":
      s.removeTerminal(cmd.terminalId);
      break;
    case "open_app_page":
      // Opens the page-tab AND shows it (store semantics); on an already-open
      // page this just brings it back into view.
      s.openAppPage(cmd.page);
      break;
    case "close_app_page":
      // Closing a not-open page is a clean no-op in the store.
      s.closeAppPage(cmd.page);
      break;
    case "start_dev_server":
      await startManagedDevTerminal(cmd.command, cmd.startedBy);
      break;
    case "connect_extension":
      return connectExtension(cmd.id);
  }
  return null;
}

// Start an extension's connect flow, exactly as its Hub button would -- the
// same runExtensionAction both paths share, so the two cannot drift.
//
// It reports what the user must still DO rather than claiming success: every
// one of these flows ends in a human step (approve in the browser, paste a key,
// answer a CLI prompt), and a tool that returned "connected" the moment it
// opened a dialog would have Claude confidently lying about the outcome.
async function connectExtension(id: string): Promise<ConnectStarted> {
  const rows = await window.airlock.extensionsList();
  const e = rows.find((r) => r.id === id);
  if (!e)
    throw new Error(
      `Unknown extension "${id}". Call extension_status to list them.`,
    );

  const action = primaryConnectAction(e);
  if (!action) {
    // Already connected, or genuinely offers nothing -- distinct outcomes, so
    // say which. Neither is an error.
    return {
      id: e.id,
      name: e.name,
      started: false,
      action: null,
      status: e.status,
      nextStep:
        e.status === "connected" || e.status === "ready"
          ? `${e.name} is already connected.`
          : `${e.name} offers no connect action here.`,
    };
  }

  const root =
    useApp.getState().tabState[useApp.getState().activeTabId]?.root ?? null;
  const nextStep = runExtensionAction(e, action, root);
  return {
    id: e.id,
    name: e.name,
    started: true,
    action: action.kind,
    status: e.status,
    nextStep,
  };
}

export function useAgentCommands(): void {
  useEffect(() => {
    return window.airlock.onAgentCommand(async ({ id, cmd }) => {
      try {
        // Most commands answer with the layout snapshot; connect_extension
        // answers with what it started, which a snapshot cannot express.
        const extra = await applyCommand(cmd);
        window.airlock.agentCommandResult(id, {
          ok: true,
          data: extra ?? buildSnapshot(),
        });
      } catch (e) {
        window.airlock.agentCommandResult(id, { ok: false, error: String(e) });
      }
    });
  }, []);
}
