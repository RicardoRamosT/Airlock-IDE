import { describe, expect, it, vi } from "vitest";
import type { SlackTransport } from "./client";
import { authTest, channelHistory, listChannels, listUsers } from "./client";

describe("slack client (fake transport)", () => {
  it("authTest calls auth.test and parses the result", async () => {
    const tx: SlackTransport = vi.fn(async () => ({ ok: true, team: "Acme" }));
    const a = await authTest("xoxb-tok", tx);
    expect(a.ok).toBe(true);
    expect(a.team).toBe("Acme");
    expect(tx).toHaveBeenCalledWith("auth.test", "xoxb-tok", {});
  });

  it("requests all four types in one call when opted in + scoped", async () => {
    const tx: SlackTransport = vi.fn(async () => ({
      ok: true,
      channels: [{ id: "C1", name: "general" }],
    }));
    const chans = await listChannels("t", true, tx);
    expect(chans).toEqual([{ id: "C1", name: "general", kind: "public" }]);
    expect(tx).toHaveBeenCalledTimes(1);
    expect(tx).toHaveBeenCalledWith("conversations.list", "t", {
      types: "public_channel,private_channel,mpim,im",
      exclude_archived: "true",
      limit: "1000",
    });
  });

  it("falls back to a per-type union when the combined call missing_scope", async () => {
    const tx: SlackTransport = vi.fn(async (_m, _t, params) => {
      if (params.types === "public_channel,private_channel,mpim,im")
        return { ok: false, error: "missing_scope" };
      if (params.types === "public_channel")
        return { ok: true, channels: [{ id: "C1", name: "general" }] };
      if (params.types === "im")
        return { ok: true, channels: [{ id: "D1", is_im: true, user: "U9" }] };
      return { ok: false, error: "missing_scope" }; // private_channel, mpim ungranted
    });
    const chans = await listChannels("t", true, tx);
    expect(chans).toEqual([
      { id: "C1", name: "general", kind: "public" },
      { id: "D1", name: "", kind: "im", userId: "U9" },
    ]);
    expect(tx).toHaveBeenCalledTimes(5); // 1 combined + 4 per-type
  });

  it("lists only public channels when opted out (one call)", async () => {
    const tx: SlackTransport = vi.fn(async () => ({
      ok: true,
      channels: [{ id: "C1", name: "general" }],
    }));
    const chans = await listChannels("t", false, tx);
    expect(chans).toEqual([{ id: "C1", name: "general", kind: "public" }]);
    expect(tx).toHaveBeenCalledTimes(1);
    expect(tx).toHaveBeenCalledWith("conversations.list", "t", {
      types: "public_channel",
      exclude_archived: "true",
      limit: "1000",
    });
  });

  it("listUsers calls users.list and parses members", async () => {
    const tx: SlackTransport = vi.fn(async () => ({
      ok: true,
      members: [{ id: "U1", profile: { display_name: "Ally" } }],
    }));
    expect(await listUsers("t", tx)).toEqual([{ id: "U1", name: "Ally" }]);
    expect(tx).toHaveBeenCalledWith("users.list", "t", { limit: "1000" });
  });

  it("channelHistory clamps the limit to [1,100] and parses messages", async () => {
    const tx: SlackTransport = vi.fn(async () => ({
      ok: true,
      messages: [{ ts: "1.1", user: "U1", text: "hi" }],
    }));
    const r = await channelHistory("t", "C1", 5000, tx);
    expect(r).toEqual({
      ok: true,
      messages: [{ ts: "1.1", user: "U1", text: "hi", files: [] }],
    });
    expect(tx).toHaveBeenCalledWith("conversations.history", "t", {
      channel: "C1",
      limit: "100",
    });
  });
});

describe("channelHistory result shape", () => {
  it("returns ok:true with parsed messages", async () => {
    const tx: SlackTransport = async () => ({
      ok: true,
      messages: [{ ts: "1.0", user: "U1", text: "hi" }],
    });
    await expect(channelHistory("tok", "C1", 20, tx)).resolves.toEqual({
      ok: true,
      messages: [{ ts: "1.0", user: "U1", text: "hi", files: [] }],
    });
  });

  it("propagates a Slack refusal instead of an empty list", async () => {
    const tx: SlackTransport = async () => ({
      ok: false,
      error: "not_in_channel",
    });
    await expect(channelHistory("tok", "C1", 20, tx)).resolves.toEqual({
      ok: false,
      error: "not_in_channel",
    });
  });
});
