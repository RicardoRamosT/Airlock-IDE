import { describe, expect, it } from "vitest";
import type { ExtensionSummary } from "../../../shared/ipc";
import { primaryConnectAction } from "./extensionActions";

const row = (patch: Partial<ExtensionSummary> = {}): ExtensionSummary =>
  ({
    id: "neon",
    name: "Neon",
    icon: "neon",
    tier: "section",
    status: "unauthed",
    enabled: true,
    pinned: false,
    hasConfig: false,
    authKind: "token",
    hasSection: true,
    actions: [],
    ...patch,
  }) as ExtensionSummary;

describe("primaryConnectAction", () => {
  it("NEVER selects disconnect -- asking Claude to connect cannot tear one down", () => {
    // The load-bearing safety property of extension_connect. A connected Slack
    // offers changeWorkspace + disconnect and nothing else; the answer must be
    // "nothing to do", not the destructive action that happens to be present.
    const connected = row({
      id: "slack",
      name: "Slack",
      tier: "connected",
      status: "connected",
      actions: [
        { kind: "changeWorkspace", label: "Change Slack workspace" },
        { kind: "disconnect", label: "Disconnect Slack", danger: true },
      ],
    });
    expect(primaryConnectAction(connected)).toBeNull();
  });

  it("prefers install over the section fallback, so the real fix comes first", () => {
    const acts = row({
      status: "absent",
      actions: [
        { kind: "install", label: "Install Snowflake CLI", command: "brew x" },
        { kind: "openSection", label: "Open Snowflake" },
      ],
    });
    expect(primaryConnectAction(acts)?.kind).toBe("install");
  });

  it("falls back to opening the section, which for Neon IS the connect path", () => {
    // Neon declares no CLI connect command -- its API key is pasted into its
    // own section, so without this the tool would report "nothing to do" for an
    // extension that is plainly not connected.
    const acts = row({
      actions: [{ kind: "openSection", label: "Open Neon" }],
    });
    expect(primaryConnectAction(acts)?.kind).toBe("openSection");
  });

  it("returns null when a row offers nothing at all", () => {
    expect(primaryConnectAction(row({ actions: [] }))).toBeNull();
  });

  it("tolerates a row with no actions field", () => {
    expect(primaryConnectAction(row({ actions: undefined }))).toBeNull();
  });
});
