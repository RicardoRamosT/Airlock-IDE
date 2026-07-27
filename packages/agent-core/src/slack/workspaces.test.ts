import { describe, expect, it } from "vitest";
import {
  parseWorkspaceInput,
  requestedWorkspaceName,
  workspaceMismatch,
} from "./workspaces";

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

describe("workspaceMismatch", () => {
  it("is false when nothing was requested", () => {
    expect(workspaceMismatch({}, { teamId: "T1", domain: "acme" })).toBe(false);
  });

  it("is false when the team ids agree, case-insensitively", () => {
    expect(
      workspaceMismatch({ teamId: "t1abcdef" }, { teamId: "T1ABCDEF" }),
    ).toBe(false);
  });

  it("is true when the team ids disagree", () => {
    expect(
      workspaceMismatch({ teamId: "T0BGEUK686M" }, { teamId: "T0BEVD71P6Z" }),
    ).toBe(true);
  });

  it("falls back to the domain when no team id was requested", () => {
    expect(workspaceMismatch({ domain: "acme" }, { domain: "beta" })).toBe(true);
    expect(workspaceMismatch({ domain: "acme" }, { domain: "ACME" })).toBe(
      false,
    );
  });

  it("prefers the team id over the domain when both are known", () => {
    // Same workspace renamed its subdomain -- the id is authoritative.
    expect(
      workspaceMismatch(
        { teamId: "T1", domain: "old" },
        { teamId: "T1", domain: "new" },
      ),
    ).toBe(false);
  });

  it("is false when the two sides share nothing comparable", () => {
    // Requested by domain, auth.test gave only an id -> we cannot tell, so we
    // must not accuse. Verification never cries wolf.
    expect(workspaceMismatch({ domain: "acme" }, { teamId: "T1" })).toBe(false);
  });
});

describe("requestedWorkspaceName", () => {
  it("prefers the human name the picker supplied", () => {
    expect(
      requestedWorkspaceName({ teamId: "T1", domain: "acme" }, "Acme Inc"),
    ).toBe("Acme Inc");
  });

  it("falls back to the workspace domain when the name is unknown", () => {
    expect(requestedWorkspaceName({ domain: "ricardos-test-workspace" })).toBe(
      "ricardos-test-workspace.slack.com",
    );
  });

  it("falls back to the raw team id when only that is known", () => {
    expect(requestedWorkspaceName({ teamId: "T0BGEUK686M" }, "  ")).toBe(
      "T0BGEUK686M",
    );
  });

  it("is empty when nothing was requested", () => {
    expect(requestedWorkspaceName({})).toBe("");
  });
});
