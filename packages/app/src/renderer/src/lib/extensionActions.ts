// Performing an extension action.
//
// The DECISION of which actions exist is agent-core's (extensionActions, pure
// and unit-tested); this is the other half -- turning one of them into
// behavior. It lived inside ExtensionsTab as a closure, which was fine while
// the hub was the only caller. It is shared now because Claude can start a
// connect flow too (the connect_extension agent command), and a second copy of
// this switch is how the agent path and the button path drift apart.

import type {
  ExtensionAction,
  ExtensionSummary,
  Section,
} from "../../../shared/ipc";
import { useApp } from "../store";

// The kinds that move an extension TOWARD being connected. extension_connect
// picks from this set and nothing else -- notably it can never select
// "disconnect", so asking Claude to connect something can never tear down a
// working connection. "openSection" counts: for Neon and Render the section is
// the only place an API key can be entered, so opening it IS the connect step.
const CONNECTING: ExtensionAction["kind"][] = [
  "install",
  "connectCli",
  "connectOauth",
  "connectToken",
  "useAccount",
  "openSection",
];

// The action to take to get this extension connected, or null when there is
// nothing to do (already connected, or disabled with no path forward).
export function primaryConnectAction(
  e: ExtensionSummary,
): ExtensionAction | null {
  const acts = e.actions ?? [];
  for (const kind of CONNECTING) {
    // Choosing WHICH identity a project uses is not a guess Claude should
    // make. With one pooled account there is nothing to guess; with several,
    // fall through so extension_connect reports the choices and stops.
    if (kind === "useAccount") {
      const uses = acts.filter((a) => a.kind === "useAccount");
      if (uses.length === 1) return uses[0] ?? null;
      continue;
    }
    const hit = acts.find((a) => a.kind === kind);
    if (hit) return hit;
  }
  return null;
}

// Reveal an extension's own rail area, restoring the sidebar (the hub collapses
// it on open). The page tab stays open: discarding it is the tab's own X, not a
// side effect of navigating.
export function openExtensionSection(id: string): void {
  const s = useApp.getState();
  const view = `ext:${id}` as Section;
  s.setActiveView(view);
  s.setSidebarVisible(true);
  void window.airlock.prefsSet({ activeView: view, sidebarVisible: true });
}

// Perform one action. Returns a short description of what the USER now has to
// do, or null when the action completes on its own -- the agent path reports
// this back so Claude can tell the user where to look instead of claiming the
// extension is connected when a browser page is still waiting for a click.
export function runExtensionAction(
  e: ExtensionSummary,
  a: ExtensionAction,
  root: string | null,
): string | null {
  switch (a.kind) {
    case "install":
    case "connectCli":
      // User-initiated: the command is put in a terminal, never auto-run.
      if (a.command) {
        useApp.getState().runInNewTerminal(a.command);
        // ...and then SHOW that terminal. The Extensions hub is a full-width
        // page rendered in the workspace slot, so a terminal created while it
        // is open lands BEHIND it: the command was running and prompting the
        // whole time, invisibly, and the button read as broken. Re-selecting
        // the active tab is the store's existing way to surface the panes from
        // under an IDE page (see switchTab), so this reuses that rather than
        // reaching into appPage directly. Read the id AFTER the terminal is
        // added, so it is the tab that actually received it.
        const s = useApp.getState();
        s.switchTab(s.activeTabId);
        return `Running \`${a.command}\` in a new terminal -- follow its prompts.`;
      }
      return null;
    case "connectOauth":
      useApp.getState().setModal({ oauthDevice: { id: e.id, name: e.name } });
      return `Opened the ${e.name} sign-in dialog -- approve it in your browser.`;
    case "connectToken":
      // Slack owns the only paste-a-token modal there is. Guarded, so a future
      // token extension does nothing here rather than opening the WRONG
      // extension's connect flow.
      if (e.id === "slack") {
        useApp.getState().setModal("connect-slack");
        return `Opened the ${e.name} connect dialog.`;
      }
      return null;
    case "changeWorkspace":
      useApp
        .getState()
        .setModal({ oauthDevice: { id: e.id, name: e.name, manage: true } });
      return `Opened the ${e.name} workspace picker.`;
    case "configure":
      // Likewise: "slack-channels" is Slack's allow-list, not a generic config
      // editor. Per-extension config-schema editing is future work.
      if (e.id === "slack") {
        useApp.getState().setModal("slack-channels");
        return `Opened the ${e.name} channel allow-list.`;
      }
      return null;
    case "useAccount":
      // Binding handles NO credential: the token is already pooled in main,
      // and this only records which workspace this project uses.
      if (a.accountId && root) {
        void window.airlock.slackBindWorkspace(root, a.accountId);
        return `Connected to ${a.label.replace(/^Use /, "")}.`;
      }
      return null;
    case "disconnect":
      if (root) void window.airlock.extensionsDisconnect(root, e.id);
      return null;
    case "openSection":
      openExtensionSection(e.id);
      return `Opened the ${e.name} section in the sidebar -- connect it there.`;
  }
}
