import { describe, expect, it } from "vitest";
import { parseAuthTest, parseChannels, parseHistory } from "./parse";

describe("parseAuthTest", () => {
  it("reads team/user on ok", () => {
    const a = parseAuthTest({
      ok: true,
      url: "https://acme.slack.com/",
      team: "Acme",
      user: "ricardo",
      team_id: "T1",
      user_id: "U1",
    });
    expect(a).toEqual({
      ok: true,
      team: "Acme",
      user: "ricardo",
      teamId: "T1",
      userId: "U1",
    });
  });
  it("reads the error on failure", () => {
    expect(parseAuthTest({ ok: false, error: "invalid_auth" })).toEqual({
      ok: false,
      error: "invalid_auth",
    });
  });
  it("degrades a garbage payload to not-ok", () => {
    expect(parseAuthTest(null).ok).toBe(false);
    expect(parseAuthTest("nope").ok).toBe(false);
  });
});

describe("parseChannels kind", () => {
  it("public channel", () => {
    expect(
      parseChannels({ ok: true, channels: [{ id: "C1", name: "general" }] }),
    ).toEqual([{ id: "C1", name: "general", kind: "public" }]);
  });
  it("private channel", () => {
    expect(
      parseChannels({
        ok: true,
        channels: [{ id: "G1", name: "secret", is_private: true }],
      }),
    ).toEqual([{ id: "G1", name: "secret", kind: "private" }]);
  });
  it("group DM (mpim) -- is_mpim wins over is_private", () => {
    expect(
      parseChannels({
        ok: true,
        channels: [
          { id: "G2", name: "mpdm-a--b-1", is_private: true, is_mpim: true },
        ],
      }),
    ).toEqual([{ id: "G2", name: "mpdm-a--b-1", kind: "mpim" }]);
  });
  it("1:1 DM (im) captures userId, no name", () => {
    expect(
      parseChannels({
        ok: true,
        channels: [{ id: "D1", is_im: true, user: "U9" }],
      }),
    ).toEqual([{ id: "D1", name: "", kind: "im", userId: "U9" }]);
  });
  it("skips archived + non-string ids; [] on bad payload", () => {
    expect(
      parseChannels({
        ok: true,
        channels: [{ id: "C1", name: "a", is_archived: true }, { name: "b" }],
      }),
    ).toEqual([]);
    expect(parseChannels({ ok: false })).toEqual([]);
    expect(parseChannels(null)).toEqual([]);
  });
});

describe("parseHistory", () => {
  it("maps messages to {ts,user,text}", () => {
    const msgs = parseHistory({
      ok: true,
      messages: [
        { type: "message", user: "U1", text: "hi", ts: "1.1" },
        { type: "message", user: "U2", text: "there", ts: "2.2" },
      ],
    });
    expect(msgs).toEqual([
      { ts: "1.1", user: "U1", text: "hi" },
      { ts: "2.2", user: "U2", text: "there" },
    ]);
  });
  it("tolerates missing user/text and bad payloads", () => {
    expect(parseHistory({ ok: true, messages: [{ ts: "3.3" }] })).toEqual([
      { ts: "3.3", user: "", text: "" },
    ]);
    expect(parseHistory(null)).toEqual([]);
  });
});
