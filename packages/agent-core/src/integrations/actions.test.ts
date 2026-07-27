import { describe, expect, it } from "vitest";
import { extensionActions, withActions } from "./actions";
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

  it("offers nothing to act on for a ready manifest row", () => {
    // A CLI that is installed and logged in needs no button.
    expect(
      kinds({ tier: "status", status: "ready", hasConfig: false }),
    ).toEqual([]);
  });

  it("offers nothing on an errored row", () => {
    // The status probe failed, so we do not know what is safe to offer --
    // Connect/Disconnect would both be guesses.
    expect(kinds({ status: "error" })).toEqual([]);
    expect(
      kinds({ tier: "status", status: "error", hasConfig: false }),
    ).toEqual([]);
  });

  it("offers nothing on a disabled row", () => {
    // Not an edge case: this is every user who unchecks "Enabled". A disabled
    // extension must not offer Connect/Configure/Disconnect.
    expect(kinds({ status: "disabled", enabled: false })).toEqual([]);
    expect(
      kinds({
        tier: "status",
        status: "disabled",
        enabled: false,
        hasConfig: false,
        install: { command: "brew install snowflake-cli" },
      }),
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

describe("withActions", () => {
  it("returns each row unchanged plus its actions", () => {
    const rows: ExtensionSummary[] = [
      base,
      {
        ...base,
        id: "snowflake",
        name: "Snowflake",
        tier: "status",
        status: "absent",
        hasConfig: false,
        authKind: "token",
        install: { command: "brew install snowflake-cli" },
      },
    ];
    expect(withActions(rows)).toEqual([
      { ...base, actions: extensionActions(base) },
      { ...rows[1], actions: extensionActions(rows[1] as ExtensionSummary) },
    ]);
    // Spelled out, so the test fails if extensionActions AND withActions both
    // regress in the same direction.
    expect(withActions(rows)[1]?.actions).toEqual([
      {
        kind: "install",
        label: "Install Snowflake",
        command: "brew install snowflake-cli",
      },
    ]);
  });

  it("does not mutate the rows it was given", () => {
    const row = { ...base };
    const [out] = withActions([row]);
    expect(row.actions).toBeUndefined();
    expect(out?.actions?.length).toBeGreaterThan(0);
  });

  it("maps an empty list to an empty list", () => {
    expect(withActions([])).toEqual([]);
  });
});

// Neon and Render connect by pasting an API key into their OWN section -- they
// declare no CLI connect command, so before this the hub gave a not-connected
// Neon row an accurate "Not connected." and then NO way to act on it. That is
// the dead end the Databases/Host router rule forbids ("every row links
// onward"), reproduced on the surface whose whole job is discovery.
describe("openSection", () => {
  const sectionRow = (patch: Partial<ExtensionSummary> = {}) =>
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
      ...patch,
    }) as ExtensionSummary;

  it("gives a not-connected section extension a way in", () => {
    const acts = extensionActions(sectionRow());
    expect(acts).toEqual([{ kind: "openSection", label: "Open Neon" }]);
  });

  it("offers it for an absent section extension too", () => {
    expect(
      extensionActions(sectionRow({ status: "absent" })).map((a) => a.kind),
    ).toEqual(["openSection"]);
  });

  it("stays LAST, so a real connect action remains the primary button", () => {
    const acts = extensionActions(
      sectionRow({
        id: "snowflake",
        name: "Snowflake",
        tier: "status",
        status: "absent",
        install: { command: "brew install snowflake-cli" },
      }),
    );
    expect(acts.map((a) => a.kind)).toEqual(["install", "openSection"]);
  });

  it("is NOT offered to an extension with no section of its own", () => {
    // Slack owns no rail area of this kind; an "Open Slack" button would go
    // nowhere.
    const acts = extensionActions(
      sectionRow({
        id: "slack",
        name: "Slack",
        tier: "connected",
        status: "unauthed",
        authKind: "oauth2",
        hasSection: false,
      }),
    );
    expect(acts.map((a) => a.kind)).toEqual(["connectOauth"]);
  });
});
