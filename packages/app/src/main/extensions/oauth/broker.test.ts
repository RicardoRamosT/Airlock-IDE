import type { AuthSpec } from "@airlock/agent-core";
import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl } from "./broker";

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
});
