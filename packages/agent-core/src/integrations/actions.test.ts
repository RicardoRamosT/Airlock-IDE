import { describe, expect, it } from "vitest";
import { extensionActions } from "./actions";
import type { ExtensionSummary } from "./summary";

const base: ExtensionSummary = {
  id: "slack",
  name: "Slack",
  tier: "connected",
  status: "connected",
  enabled: true,
  pinned: false,
  hasConfig: true,
  authKind: "oauth2",
};
const kinds = (e: Partial<ExtensionSummary>) =>
  extensionActions({ ...base, ...e }).map((a) => a.kind);

describe("extensionActions", () => {
  it("offers Install with its command on an absent manifest row", () => {
    const [a] = extensionActions({
      ...base,
      tier: "status",
      status: "absent",
      hasConfig: false,
      install: { command: "brew install snowflake-cli" },
    });
    expect(a).toEqual({
      kind: "install",
      label: "Install Slack",
      command: "brew install snowflake-cli",
    });
  });

  it("offers no Install when the manifest supplies no command", () => {
    // A button that runs nothing is worse than no button.
    expect(
      kinds({ tier: "status", status: "absent", hasConfig: false }),
    ).toEqual([]);
  });

  it("offers the CLI connect on an unauthed manifest row", () => {
    expect(
      kinds({
        tier: "status",
        status: "unauthed",
        hasConfig: false,
        connect: { command: "az login" },
      }),
    ).toEqual(["connectCli"]);
  });

  it("offers the browser login for an unauthed oauth2 extension", () => {
    expect(kinds({ status: "unauthed" })).toEqual(["connectOauth"]);
  });

  it("offers the paste-a-token flow for an unauthed token extension", () => {
    expect(kinds({ status: "unauthed", authKind: "token" })).toEqual([
      "connectToken",
    ]);
  });

  it("offers workspace, configure and disconnect once connected", () => {
    expect(kinds({ status: "connected" })).toEqual([
      "changeWorkspace",
      "configure",
      "disconnect",
    ]);
  });

  it("omits Change workspace for a connected extension that is not Slack", () => {
    // Only Slack has a workspace to change; GitHub must not show a dead button.
    expect(
      kinds({ id: "github", status: "connected", hasConfig: false }),
    ).toEqual(["disconnect"]);
  });

  it("omits Configure when the extension has no config schema", () => {
    expect(
      kinds({ id: "github", status: "connected", hasConfig: false }),
    ).not.toContain("configure");
  });

  it("offers nothing to act on for a ready manifest row", () => {
    // A CLI that is installed and logged in needs no button.
    expect(
      kinds({ tier: "status", status: "ready", hasConfig: false }),
    ).toEqual([]);
  });

  it("names the extension in every label so a button reads alone", () => {
    for (const a of extensionActions({ ...base, status: "connected" })) {
      expect(a.label).toContain("Slack");
    }
  });

  it("marks disconnect as dangerous", () => {
    const d = extensionActions({ ...base, status: "connected" }).find(
      (a) => a.kind === "disconnect",
    );
    expect(d?.danger).toBe(true);
  });
});
