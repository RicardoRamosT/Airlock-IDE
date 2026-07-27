import { describe, expect, it } from "vitest";
import { parseWorkspaceInput } from "./workspaces";

describe("parseWorkspaceInput", () => {
  it("reads a bare team id, upper-cased", () => {
    expect(parseWorkspaceInput("t0123abcd")).toEqual({ teamId: "T0123ABCD" });
  });

  it("reads the team id out of an app.slack.com/client link", () => {
    // "app" is Slack's own host, not a workspace subdomain -> no domain.
    expect(
      parseWorkspaceInput("https://app.slack.com/client/T0123ABCD/C07770000"),
    ).toEqual({ teamId: "T0123ABCD" });
  });

  it("reads the subdomain out of a full workspace URL", () => {
    expect(parseWorkspaceInput("https://airlockespacio.slack.com/")).toEqual({
      domain: "airlockespacio",
    });
  });

  it("reads a bare domain with no scheme", () => {
    expect(parseWorkspaceInput("airlockespacio.slack.com")).toEqual({
      domain: "airlockespacio",
    });
  });

  it("reads a bare slug", () => {
    expect(parseWorkspaceInput("ricardos-test-workspace")).toEqual({
      domain: "ricardos-test-workspace",
    });
  });

  it("reads BOTH halves from a workspace-subdomain client link", () => {
    expect(
      parseWorkspaceInput(
        "https://airlockespacio.slack.com/client/T0BE1234/C1",
      ),
    ).toEqual({ teamId: "T0BE1234", domain: "airlockespacio" });
  });

  it("ignores an archives deep link's path but keeps the workspace", () => {
    expect(
      parseWorkspaceInput("https://airlockespacio.slack.com/archives/C0777"),
    ).toEqual({ domain: "airlockespacio" });
  });

  it("returns an empty target for junk rather than throwing", () => {
    // Nothing to pin -> Slack's own workspace picker decides, and the
    // post-connect check still catches a wrong result.
    expect(parseWorkspaceInput("team12345678 workspace")).toEqual({});
  });

  it("returns an empty target for empty input", () => {
    expect(parseWorkspaceInput("")).toEqual({});
    expect(parseWorkspaceInput("   ")).toEqual({});
  });

  it("never yields a domain that could smuggle characters into a host", () => {
    expect(parseWorkspaceInput("evil.com/#.slack.com")).toEqual({});
    expect(parseWorkspaceInput("foo_bar")).toEqual({});
  });
});
