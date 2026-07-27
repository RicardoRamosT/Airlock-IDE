// packages/agent-core/src/integrations/actions.ts
// Which actions an extension row offers, as DATA.
//
// The Hub used to decide this inline, in nested ternaries inside ~90 lines of
// sidebar JSX. That made it impossible to render the same choices anywhere else
// without copying the conditions -- and copying them is how a Connect button
// ends up on a row that cannot connect. The rule lives here now; a surface just
// renders the list.
//
// Every action names its extension ("Disconnect Slack", not "Disconnect") so a
// labelled button reads correctly on its own, away from the row it belongs to.
// ASCII-only file.
import type { ExtensionSummary } from "./summary";

export type ExtensionActionKind =
  | "install"
  | "connectCli"
  | "connectOauth"
  | "connectToken"
  | "changeWorkspace"
  | "configure"
  | "disconnect";

export interface ExtensionAction {
  kind: ExtensionActionKind;
  label: string;
  // install / connectCli only: the shell command to run in a new terminal.
  // The user starts it; nothing here auto-runs.
  command?: string;
  danger?: true;
}

// Slack is the only extension with a workspace to switch. Hard-coded rather
// than inferred: a generic "has an account" test would put a dead button on
// GitHub, whose account is chosen per project instead.
const HAS_WORKSPACE = new Set(["slack"]);

export function extensionActions(e: ExtensionSummary): ExtensionAction[] {
  const out: ExtensionAction[] = [];

  if (e.status === "absent") {
    // No command means nothing to run; a button that does nothing is worse
    // than no button.
    if (e.install?.command) {
      out.push({
        kind: "install",
        label: `Install ${e.name}`,
        command: e.install.command,
      });
    }
    return out;
  }

  if (e.status === "unauthed") {
    if (e.tier === "connected") {
      out.push(
        e.authKind === "oauth2"
          ? { kind: "connectOauth", label: `Connect ${e.name}` }
          : { kind: "connectToken", label: `Connect ${e.name}` },
      );
    } else if (e.connect?.command) {
      out.push({
        kind: "connectCli",
        label: `Connect ${e.name}`,
        command: e.connect.command,
      });
    }
    return out;
  }

  // Connected (tier-2) or ready (a manifest CLI that is installed and logged
  // in). A ready manifest row has nothing to act on -- it is already working.
  if (e.status === "connected" && e.tier === "connected") {
    if (HAS_WORKSPACE.has(e.id)) {
      out.push({
        kind: "changeWorkspace",
        label: `Change ${e.name} workspace`,
      });
    }
    if (e.hasConfig) {
      out.push({ kind: "configure", label: `Configure ${e.name}` });
    }
    out.push({
      kind: "disconnect",
      label: `Disconnect ${e.name}`,
      danger: true,
    });
  }
  return out;
}
