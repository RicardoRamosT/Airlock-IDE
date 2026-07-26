import type { SlackHistory } from "@airlock/agent-core";
import { describe, expect, it } from "vitest";
import type { AllowedChannel } from "./slack";
import { resolveAllowedChannel, slackReadChannelTool } from "./slackTools";

const allowed: AllowedChannel[] = [
  { id: "C1", name: "bugs", kind: "public" },
  { id: "C2", name: "eng", kind: "public" },
];

describe("resolveAllowedChannel (the permission gate)", () => {
  it("matches by id", () => {
    expect(resolveAllowedChannel(allowed, "C1")?.name).toBe("bugs");
  });
  it("matches by name and by #name", () => {
    expect(resolveAllowedChannel(allowed, "eng")?.id).toBe("C2");
    expect(resolveAllowedChannel(allowed, "#eng")?.id).toBe("C2");
    expect(resolveAllowedChannel(allowed, " eng ")?.id).toBe("C2");
  });
  it("REJECTS a channel that is not in the allow-list", () => {
    expect(resolveAllowedChannel(allowed, "secret")).toBeNull();
    expect(resolveAllowedChannel(allowed, "C999")).toBeNull();
    expect(resolveAllowedChannel([], "bugs")).toBeNull();
  });
});

// Inject every impure dependency so the gate + result mapping are testable
// without disk config or the keychain.
function deps(history: SlackHistory) {
  return {
    allowed: async () => allowed,
    token: async () => "xoxp-test",
    history: async () => history,
    users: async () => [{ id: "U1", name: "Ricardo" }],
  };
}

describe("slackReadChannelTool result mapping", () => {
  it("returns an error (NOT empty messages) when Slack refuses", async () => {
    const res = await slackReadChannelTool(
      "/repo",
      "bugs",
      20,
      deps({ ok: false, error: "missing_scope" }),
    );
    expect(res.error).toContain("missing_scope");
    expect(res.messages).toBeUndefined();
  });

  it("returns an EMPTY list for a genuinely empty channel", async () => {
    const res = await slackReadChannelTool(
      "/repo",
      "bugs",
      20,
      deps({ ok: true, messages: [] }),
    );
    expect(res.error).toBeUndefined();
    expect(res.messages).toEqual([]);
    expect(res.channel).toBe("#bugs");
  });

  it("still REFUSES a channel outside the allow-list before calling Slack", async () => {
    let called = false;
    const res = await slackReadChannelTool("/repo", "secret", 20, {
      allowed: async () => allowed,
      token: async () => "xoxp-test",
      history: async () => {
        called = true;
        return { ok: true as const, messages: [] };
      },
      users: async () => [],
    });
    expect(res.error).toContain("not allowed");
    expect(called).toBe(false);
  });

  it("reports 'not connected' when there is no vaulted token", async () => {
    const res = await slackReadChannelTool("/repo", "bugs", 20, {
      allowed: async () => allowed,
      token: async () => null,
      history: async () => ({ ok: true as const, messages: [] }),
      users: async () => [],
    });
    expect(res.error).toContain("not connected");
  });
});
