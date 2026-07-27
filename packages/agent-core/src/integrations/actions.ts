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
  | "disconnect"
  | "openSection";

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

// An extension that owns a rail area can always be opened, and for several of
// them that is the ONLY way in: Neon and Render connect by pasting an API key
// into their own section, so they offer no connect action here at all. Without
// this the hub states an accurate "Not connected." and then strands the user --
// the same dead end the Databases/Host router rule exists to forbid ("every row
// links onward"). Appended LAST so a real connect action, where one exists,
// stays the primary button.
function withOpenSection(
  e: ExtensionSummary,
  out: ExtensionAction[],
): ExtensionAction[] {
  if (e.hasSection === true)
    out.push({ kind: "openSection", label: `Open ${e.name}` });
  return out;
}

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
    return withOpenSection(e, out);
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
    return withOpenSection(e, out);
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
  return withOpenSection(e, out);
}

// Attach every row's actions. This is the SEAM the whole hub page rests on: the
// renderer cannot value-import agent-core, so the decision has to ride along
// with the data, and the only place that can attach it is the extensions:list
// IPC handler. As an inline `.map` there it was untestable -- deleting it left
// every test green while every button in the UI vanished. Named and exported
// here so it is a unit with a test instead.
export function withActions(rows: ExtensionSummary[]): ExtensionSummary[] {
  return rows.map((r) => ({ ...r, actions: extensionActions(r) }));
}
