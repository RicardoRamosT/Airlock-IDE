import { describe, expect, it, vi } from "vitest";
import { exchangeAndTicket, extractToken, type KV, redeem } from "./core";

function fakeKV(): KV & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async put(k, v) {
      map.set(k, v);
    },
    async get(k) {
      return map.get(k) ?? null;
    },
    async delete(k) {
      map.delete(k);
    },
  };
}

describe("extractToken", () => {
  it("reads a top-level access_token (bot/generic OAuth)", () => {
    expect(extractToken({ access_token: "T" })).toBe("T");
  });
  it("reads Slack's authed_user.access_token (user token)", () => {
    expect(extractToken({ ok: true, authed_user: { access_token: "U" } })).toBe(
      "U",
    );
  });
  it("returns null on failure / garbage", () => {
    expect(extractToken({ ok: false, error: "bad" })).toBeNull();
    expect(extractToken(null)).toBeNull();
  });
});

describe("exchangeAndTicket + redeem", () => {
  it("exchanges, stashes under a one-time ticket, redeems once", async () => {
    const kv = fakeKV();
    const fx = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, authed_user: { access_token: "TOK" } }),
    }));
    const ticket = await exchangeAndTicket(
      { tokenUrl: "t", clientId: "c", clientSecret: "s" },
      "code",
      "https://w/callback",
      { fx, kv, newTicket: () => "TICKET1" },
    );
    expect(ticket).toBe("TICKET1");
    expect(kv.map.get("t:TICKET1")).toBe("TOK");
    expect(await redeem(kv, "TICKET1")).toBe("TOK");
    expect(await redeem(kv, "TICKET1")).toBeNull(); // single-use
  });

  it("returns null (stores nothing) when the exchange fails", async () => {
    const kv = fakeKV();
    const fx = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: false, error: "invalid_code" }),
    }));
    expect(
      await exchangeAndTicket(
        { tokenUrl: "t", clientId: "c", clientSecret: "s" },
        "bad",
        "r",
        { fx, kv, newTicket: () => "X" },
      ),
    ).toBeNull();
    expect(kv.map.size).toBe(0);
  });
});
