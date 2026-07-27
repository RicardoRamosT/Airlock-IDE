import { describe, expect, it } from "vitest";
import {
  cleanMpimName,
  labelConversations,
  parseAuthTest,
  parseChannels,
  parseFiles,
  parseHistory,
  parseUsers,
} from "./parse";

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
      domain: "acme",
    });
  });
  it("omits domain when auth.test returns no usable url", () => {
    expect(parseAuthTest({ ok: true, team_id: "T1" }).domain).toBeUndefined();
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

describe("parseUsers", () => {
  // users.list already carries the avatar, so a real profile picture costs no
  // extra request -- but only if the parser stops throwing it away.
  it("keeps the profile image, preferring 72px", () => {
    const users = parseUsers({
      ok: true,
      members: [
        {
          id: "U1",
          name: "u1",
          profile: { image_48: "http://x/48.png", image_72: "http://x/72.png" },
        },
      ],
    });
    expect(users[0]?.avatar).toBe("http://x/72.png");
  });

  it("prefers display_name, then real_name, then name; skips deleted", () => {
    expect(
      parseUsers({
        ok: true,
        members: [
          {
            id: "U1",
            name: "u1",
            real_name: "Real One",
            profile: { display_name: "Ally" },
          },
          { id: "U2", name: "u2", profile: {} },
          { id: "U3", deleted: true, name: "gone" },
        ],
      }),
    ).toEqual([
      { id: "U1", name: "Ally", avatar: "" },
      { id: "U2", name: "u2", avatar: "" },
    ]);
  });
  it("non-ok -> []", () => {
    expect(parseUsers({ ok: false })).toEqual([]);
  });
});

describe("cleanMpimName", () => {
  it("mpdm-alice--bob--carol-1 -> alice, bob, carol", () => {
    expect(cleanMpimName("mpdm-alice--bob--carol-1")).toBe("alice, bob, carol");
  });
  it("passes unknown formats through split", () => {
    expect(cleanMpimName("weird")).toBe("weird");
  });
});

describe("labelConversations", () => {
  const users = [{ id: "U9", name: "Alice" }];
  it("labels im with the resolved user name", () => {
    expect(
      labelConversations(
        [{ id: "D1", name: "", kind: "im", userId: "U9" }],
        users,
      ),
    ).toEqual([{ id: "D1", name: "Alice (DM)", kind: "im" }]);
  });
  it("falls back to the user id when unresolved", () => {
    expect(
      labelConversations(
        [{ id: "D2", name: "", kind: "im", userId: "U0" }],
        users,
      ),
    ).toEqual([{ id: "D2", name: "U0 (DM)", kind: "im" }]);
  });
  it("labels mpim from the member slug", () => {
    expect(
      labelConversations(
        [{ id: "G2", name: "mpdm-alice--bob-1", kind: "mpim" }],
        users,
      ),
    ).toEqual([{ id: "G2", name: "alice, bob (group)", kind: "mpim" }]);
  });
  it("passes channels through unchanged", () => {
    expect(
      labelConversations(
        [{ id: "C1", name: "general", kind: "public" }],
        users,
      ),
    ).toEqual([{ id: "C1", name: "general", kind: "public" }]);
  });
});

describe("parseHistory", () => {
  it("maps messages to {ts,user,text}", () => {
    const r = parseHistory({
      ok: true,
      messages: [
        { type: "message", user: "U1", text: "hi", ts: "1.1" },
        { type: "message", user: "U2", text: "there", ts: "2.2" },
      ],
    });
    expect(r).toEqual({
      ok: true,
      messages: [
        { ts: "1.1", user: "U1", text: "hi", files: [] },
        { ts: "2.2", user: "U2", text: "there", files: [] },
      ],
    });
  });
  it("tolerates missing user/text and bad payloads", () => {
    expect(parseHistory({ ok: true, messages: [{ ts: "3.3" }] })).toEqual({
      ok: true,
      messages: [{ ts: "3.3", user: "", text: "", files: [] }],
    });
    expect(parseHistory(null)).toEqual({ ok: false, error: "bad_response" });
  });
});

describe("parseHistory ok/error split", () => {
  it("returns the messages for an ok response", () => {
    const r = parseHistory({
      ok: true,
      messages: [{ ts: "1785047664.355179", user: "U1", text: "test" }],
    });
    expect(r).toEqual({
      ok: true,
      messages: [
        { ts: "1785047664.355179", user: "U1", text: "test", files: [] },
      ],
    });
  });

  it("distinguishes an EMPTY channel from a refusal", () => {
    expect(parseHistory({ ok: true, messages: [] })).toEqual({
      ok: true,
      messages: [],
    });
  });

  it.each([
    "not_in_channel",
    "missing_scope",
    "channel_not_found",
    "invalid_auth",
    "ratelimited",
  ])("surfaces the Slack error code %s instead of an empty list", (code) => {
    expect(parseHistory({ ok: false, error: code })).toEqual({
      ok: false,
      error: code,
    });
  });

  it("reports a malformed payload as an error, not as empty", () => {
    expect(parseHistory(null)).toEqual({ ok: false, error: "bad_response" });
    expect(parseHistory({})).toEqual({ ok: false, error: "bad_response" });
    // ok:true but no messages array is malformed, NOT an empty channel.
    expect(parseHistory({ ok: true })).toEqual({
      ok: false,
      error: "bad_response",
    });
  });

  it("defaults a missing error string to unknown_error", () => {
    expect(parseHistory({ ok: false })).toEqual({
      ok: false,
      error: "unknown_error",
    });
  });
});

describe("parseFiles", () => {
  it("maps a Slack file object to the fields we need", () => {
    expect(
      parseFiles([
        {
          id: "F123",
          name: "image.png",
          mimetype: "image/png",
          size: 4096,
          url_private: "https://files.slack.com/x.png",
        },
      ]),
    ).toEqual([
      {
        id: "F123",
        name: "image.png",
        mimetype: "image/png",
        size: 4096,
        kind: "image",
      },
    ]);
  });

  it("classifies non-images as other", () => {
    expect(
      parseFiles([
        { id: "F1", name: "a.pdf", mimetype: "application/pdf", size: 1 },
      ])[0]?.kind,
    ).toBe("other");
  });

  it("NEVER carries url_private -- the renderer must not receive a URL needing the token", () => {
    const out = parseFiles([
      {
        id: "F1",
        name: "a.png",
        mimetype: "image/png",
        size: 1,
        url_private: "https://x",
      },
    ]);
    expect(JSON.stringify(out)).not.toContain("url_private");
    expect(JSON.stringify(out)).not.toContain("https://x");
  });

  it("degrades on junk instead of throwing", () => {
    expect(parseFiles(undefined)).toEqual([]);
    expect(parseFiles("nope")).toEqual([]);
    expect(parseFiles([null, 7])).toEqual([]);
  });

  it("skips a file with no id (nothing could be fetched for it)", () => {
    expect(parseFiles([{ name: "x.png", mimetype: "image/png" }])).toEqual([]);
  });

  it("defaults a missing name/mimetype/size rather than dropping the file", () => {
    expect(parseFiles([{ id: "F9" }])).toEqual([
      { id: "F9", name: "file", mimetype: "", size: 0, kind: "other" },
    ]);
  });
});

describe("parseHistory carries files", () => {
  it("attaches parsed files to the message", () => {
    const r = parseHistory({
      ok: true,
      messages: [
        {
          ts: "1.0",
          user: "U1",
          text: "",
          files: [
            { id: "F1", name: "shot.png", mimetype: "image/png", size: 10 },
          ],
        },
      ],
    });
    expect(r).toEqual({
      ok: true,
      messages: [
        {
          ts: "1.0",
          user: "U1",
          text: "",
          files: [
            {
              id: "F1",
              name: "shot.png",
              mimetype: "image/png",
              size: 10,
              kind: "image",
            },
          ],
        },
      ],
    });
  });

  it("gives a message with no files an empty array, never undefined", () => {
    const r = parseHistory({
      ok: true,
      messages: [{ ts: "1.0", user: "U1", text: "hi" }],
    });
    expect(r).toEqual({
      ok: true,
      messages: [{ ts: "1.0", user: "U1", text: "hi", files: [] }],
    });
  });
});
