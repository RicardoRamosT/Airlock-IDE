import type { AuthSpec } from "@airlock/agent-core";
import { describe, expect, it, vi } from "vitest";
import { oauthTokenName, pollDeviceToken } from "./device";

const spec: AuthSpec = {
  kind: "oauth2",
  flow: "device",
  clientId: "c",
  deviceCodeUrl: "",
  tokenUrl: "t",
  scopes: [],
};
const noSleep = async () => {};

describe("oauthTokenName", () => {
  it("derives a stable per-extension vault key", () => {
    expect(oauthTokenName("github")).toBe("GITHUB_OAUTH_TOKEN");
  });
});

describe("pollDeviceToken", () => {
  it("polls past pending, then returns the token", async () => {
    const fx = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ error: "authorization_pending" }),
      })
      .mockResolvedValueOnce({ json: async () => ({ access_token: "TOK" }) });
    const tok = await pollDeviceToken(spec, "d", 0, 900, {
      fx,
      sleep: noSleep,
      now: () => 0,
    });
    expect(tok).toBe("TOK");
    expect(fx).toHaveBeenCalledTimes(2);
  });

  it("throws on access_denied", async () => {
    const fx = vi.fn().mockResolvedValue({
      json: async () => ({ error: "access_denied" }),
    });
    await expect(
      pollDeviceToken(spec, "d", 0, 900, { fx, sleep: noSleep, now: () => 0 }),
    ).rejects.toThrow();
  });

  it("throws when the deadline passes (timeout)", async () => {
    const fx = vi.fn().mockResolvedValue({
      json: async () => ({ error: "authorization_pending" }),
    });
    let t = 0;
    const now = () => (t += 1000); // advances past a 1s expiry immediately
    await expect(
      pollDeviceToken(spec, "d", 0, 1, { fx, sleep: noSleep, now }),
    ).rejects.toThrow(/expired|timed/i);
  });
});
