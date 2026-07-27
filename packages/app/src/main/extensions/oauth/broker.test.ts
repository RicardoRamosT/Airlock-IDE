import type { AuthSpec } from "@airlock/agent-core";
import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl, runBrokerFlow } from "./broker";

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
      buildAuthorizeUrl(slack, "S", "https://b/callback", {
        teamId: "T0123ABCD",
      }),
    );
    expect(url.searchParams.get("team")).toBe("T0123ABCD");
    expect(url.host).toBe("slack.com");
  });

  it("authorizes on the workspace's own subdomain when a domain is given", () => {
    // `team=` on the generic host is only a hint -- Slack authorizes whatever
    // workspace the browser session is signed into. The subdomain pins harder.
    const url = new URL(
      buildAuthorizeUrl(slack, "S", "https://b/callback", {
        teamId: "T0123ABCD",
        domain: "airlockespacio",
      }),
    );
    expect(url.host).toBe("airlockespacio.slack.com");
    expect(url.pathname).toBe("/oauth/v2/authorize");
    expect(url.searchParams.get("team")).toBe("T0123ABCD");
  });

  it("uses the subdomain even when no team id is known (pasted URL)", () => {
    const url = new URL(
      buildAuthorizeUrl(slack, "S", "https://b/callback", {
        domain: "ricardos-test-workspace",
      }),
    );
    expect(url.host).toBe("ricardos-test-workspace.slack.com");
    expect(url.searchParams.get("team")).toBeNull();
  });

  it("omits team and keeps the generic host for an empty target", () => {
    const url = new URL(
      buildAuthorizeUrl(slack, "S", "https://b/callback", {}),
    );
    expect(url.searchParams.get("team")).toBeNull();
    expect(url.host).toBe("slack.com");
  });

  it("omits team when no target is given (unchanged one-click default)", () => {
    const url = new URL(buildAuthorizeUrl(slack, "S", "https://b/callback"));
    expect(url.searchParams.get("team")).toBeNull();
  });
});

describe("runBrokerFlow", () => {
  it("prefixes the state with the broker provider so the worker /callback can route it", async () => {
    // The worker does providerFromState(state) = state.split(".")[0], expecting
    // "<provider>.<random>". A bare random state made it read the whole string as
    // the provider -> no config -> HTTP 400 "bad request" on every Slack redirect.
    let openedUrl = "";
    const token = await runBrokerFlow(slack, undefined, 1000, {
      open: async (url: string) => {
        openedUrl = url;
      },
      wait: async () => ({ ticket: "TKT" }),
      fx: async () => ({ json: async () => ({ token: "TOK" }) }),
    });
    expect(token).toBe("TOK");
    const state = new URL(openedUrl).searchParams.get("state") ?? "";
    expect(state.split(".")[0]).toBe("slack");
    expect(state.length).toBeGreaterThan("slack.".length);
  });
});
