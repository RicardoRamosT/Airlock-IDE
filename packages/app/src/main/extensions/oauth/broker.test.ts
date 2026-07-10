import type { AuthSpec } from "@airlock/agent-core";
import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl, normalizeTeamId } from "./broker";

const slack: Extract<AuthSpec, { flow: "broker" }> = {
  kind: "oauth2",
  flow: "broker",
  clientId: "CID",
  authorizeUrl: "https://slack.com/oauth/v2/authorize",
  brokerBaseUrl: "https://airlock-auth.example.workers.dev",
  brokerProvider: "slack",
  scopes: ["channels:history", "channels:read"],
  scopeParam: "user_scope",
  scopeSep: ",",
};

describe("buildAuthorizeUrl", () => {
  it("builds Slack's URL: user_scope (comma-joined) + redirect + state", () => {
    const url = new URL(
      buildAuthorizeUrl(
        slack,
        "STATE123",
        "https://airlock-auth.example.workers.dev/callback",
      ),
    );
    expect(url.origin + url.pathname).toBe(
      "https://slack.com/oauth/v2/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("CID");
    expect(url.searchParams.get("user_scope")).toBe(
      "channels:history,channels:read",
    );
    expect(url.searchParams.get("scope")).toBeNull();
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://airlock-auth.example.workers.dev/callback",
    );
    expect(url.searchParams.get("state")).toBe("STATE123");
  });

  it("defaults to space-joined `scope` for a generic OAuth2 provider", () => {
    const generic: Extract<AuthSpec, { flow: "broker" }> = {
      ...slack,
      scopeParam: undefined,
      scopeSep: undefined,
    };
    const url = new URL(buildAuthorizeUrl(generic, "S", "https://b/callback"));
    expect(url.searchParams.get("scope")).toBe(
      "channels:history channels:read",
    );
    expect(url.searchParams.get("user_scope")).toBeNull();
  });

  it("pins the workspace with &team= when a team id is given", () => {
    const url = new URL(
      buildAuthorizeUrl(slack, "S", "https://b/callback", "T0123ABCD"),
    );
    expect(url.searchParams.get("team")).toBe("T0123ABCD");
  });

  it("omits team when none is given (unchanged one-click default)", () => {
    const url = new URL(buildAuthorizeUrl(slack, "S", "https://b/callback"));
    expect(url.searchParams.get("team")).toBeNull();
  });
});

describe("normalizeTeamId", () => {
  it("upper-cases a bare team id", () => {
    expect(normalizeTeamId("t0123abcd")).toBe("T0123ABCD");
  });
  it("extracts the id from an app.slack.com/client URL", () => {
    expect(
      normalizeTeamId("https://app.slack.com/client/T0123ABCD/C07770000"),
    ).toBe("T0123ABCD");
  });
  it("trims and passes unrecognized text through", () => {
    expect(normalizeTeamId("  acme  ")).toBe("acme");
  });
  it("returns empty for empty input", () => {
    expect(normalizeTeamId("")).toBe("");
  });
  it("passes through free text that merely contains a team-like token", () => {
    expect(normalizeTeamId("team12345678 workspace")).toBe(
      "team12345678 workspace",
    );
  });
  it("extracts from a lowercase /client/ URL too", () => {
    expect(normalizeTeamId("https://app.slack.com/client/t0123abcd/c1")).toBe(
      "T0123ABCD",
    );
  });
});
