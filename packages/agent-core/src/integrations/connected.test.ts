import { describe, expect, it } from "vitest";
import {
  CONNECTED_EXTENSIONS,
  connectedSummary,
  SLACK_DESCRIPTOR,
  slackScopes,
} from "./connected";

describe("connectedSummary", () => {
  it("maps a connected descriptor + status + prefs to a Tier-2 summary", () => {
    const s = connectedSummary(SLACK_DESCRIPTOR, "connected", {
      slack: { pinned: true },
    });
    expect(s.id).toBe("slack");
    expect(s.tier).toBe("connected");
    expect(s.status).toBe("connected");
    expect(s.pinned).toBe(true);
    expect(s.enabled).toBe(true);
    expect(s.hasConfig).toBe(true); // has a channels field
    expect(s.category).toBe("activity"); // Slack surfaces channels into Activity
  });

  it("reports unauthed when not connected", () => {
    const s = connectedSummary(SLACK_DESCRIPTOR, "unauthed", {});
    expect(s.status).toBe("unauthed");
    expect(s.enabled).toBe(true);
    expect(s.pinned).toBe(false);
  });

  it("disabled overrides the connection status", () => {
    const s = connectedSummary(SLACK_DESCRIPTOR, "connected", {
      slack: { enabled: false },
    });
    expect(s.status).toBe("disabled");
    expect(s.enabled).toBe(false);
  });
});

describe("SLACK_DESCRIPTOR", () => {
  it("declares a channels allow-list field and ships in the registry", () => {
    expect(
      SLACK_DESCRIPTOR.configSchema.fields.some((f) => f.type === "channels"),
    ).toBe(true);
    expect(CONNECTED_EXTENSIONS.map((d) => d.id)).toContain("slack");
  });

  it("requests read+history scopes for all four conversation types", () => {
    const spec = SLACK_DESCRIPTOR.authSpec;
    const scopes = spec && "scopes" in spec ? spec.scopes : [];
    for (const s of [
      "channels:read",
      "channels:history",
      "groups:read",
      "groups:history",
      "im:read",
      "im:history",
      "mpim:read",
      "mpim:history",
      "users:read",
    ]) {
      expect(scopes).toContain(s);
    }
  });

  it("slackScopes gates the scope tier on the opt-in", () => {
    expect(slackScopes(false)).toEqual(["channels:read", "channels:history"]);
    expect(slackScopes(true)).toContain("im:read");
    expect(slackScopes(true).length).toBe(9);
  });
});
