import { describe, expect, it } from "vitest";
import { nameMessages, resolveMentions } from "./names";

const USERS = [
  { id: "U1", name: "Ricardo" },
  { id: "U2", name: "Ana" },
];

describe("resolveMentions", () => {
  it("rewrites a mention to the display name", () => {
    expect(resolveMentions("<@U1> se ha unido al canal", USERS)).toBe(
      "@Ricardo se ha unido al canal",
    );
  });

  it("rewrites several mentions in one message", () => {
    expect(resolveMentions("<@U1> ping <@U2>", USERS)).toBe(
      "@Ricardo ping @Ana",
    );
  });

  it("leaves an UNKNOWN id intact rather than blanking it", () => {
    expect(resolveMentions("<@U404> hi", USERS)).toBe("<@U404> hi");
  });

  it("handles the <@Uxxx|label> form", () => {
    expect(resolveMentions("<@U1|ricardo> hi", USERS)).toBe("@Ricardo hi");
  });

  it("returns text with no mentions unchanged", () => {
    expect(resolveMentions("plain text", USERS)).toBe("plain text");
  });
});

describe("nameMessages", () => {
  it("attaches the display name and rewrites mentions", () => {
    expect(
      nameMessages([{ ts: "1.0", user: "U1", text: "hi <@U2>" }], USERS),
    ).toEqual([
      { ts: "1.0", user: "U1", userName: "Ricardo", text: "hi @Ana" },
    ]);
  });

  it("falls back to the raw id when the user is unknown (no users:read)", () => {
    expect(nameMessages([{ ts: "1.0", user: "U9", text: "hi" }], [])).toEqual([
      { ts: "1.0", user: "U9", userName: "U9", text: "hi" },
    ]);
  });

  it("tolerates a message with no user (bot/system)", () => {
    expect(nameMessages([{ ts: "1.0", user: "", text: "hi" }], USERS)).toEqual([
      { ts: "1.0", user: "", userName: "unknown", text: "hi" },
    ]);
  });
});
