import { describe, expect, it, vi } from "vitest";
import type { SlackTransport } from "./client";
import { authTest, channelHistory, listChannels } from "./client";

describe("slack client (fake transport)", () => {
  it("authTest calls auth.test and parses the result", async () => {
    const tx: SlackTransport = vi.fn(async () => ({ ok: true, team: "Acme" }));
    const a = await authTest("xoxb-tok", tx);
    expect(a.ok).toBe(true);
    expect(a.team).toBe("Acme");
    expect(tx).toHaveBeenCalledWith("auth.test", "xoxb-tok", {});
  });

  it("listChannels requests public+private, excludes archived", async () => {
    const tx: SlackTransport = vi.fn(async () => ({
      ok: true,
      channels: [{ id: "C1", name: "general", is_private: false }],
    }));
    const chans = await listChannels("t", tx);
    expect(chans).toEqual([{ id: "C1", name: "general", isPrivate: false }]);
    expect(tx).toHaveBeenCalledWith("conversations.list", "t", {
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "1000",
    });
  });

  it("channelHistory clamps the limit to [1,100] and parses messages", async () => {
    const tx: SlackTransport = vi.fn(async () => ({
      ok: true,
      messages: [{ ts: "1.1", user: "U1", text: "hi" }],
    }));
    const msgs = await channelHistory("t", "C1", 5000, tx);
    expect(msgs).toEqual([{ ts: "1.1", user: "U1", text: "hi" }]);
    expect(tx).toHaveBeenCalledWith("conversations.history", "t", {
      channel: "C1",
      limit: "100",
    });
  });
});
