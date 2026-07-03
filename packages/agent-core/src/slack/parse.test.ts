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

describe("parseChannels", () => {
  it("maps channels and skips archived", () => {
    const chans = parseChannels({
      ok: true,
      channels: [
        { id: "C1", name: "general", is_private: false, is_archived: false },
        { id: "C2", name: "secret", is_private: true, is_archived: false },
        { id: "C3", name: "old", is_private: false, is_archived: true },
      ],
    });
    expect(chans).toEqual([
      { id: "C1", name: "general", isPrivate: false },
      { id: "C2", name: "secret", isPrivate: true },
    ]);
  });
  it("returns [] on a bad payload", () => {
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
