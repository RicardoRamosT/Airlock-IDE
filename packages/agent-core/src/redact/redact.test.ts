import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact";

describe("redactSecrets exact-match values", () => {
  it("masks a single value echoed once", () => {
    expect(redactSecrets("token is hunter2 ok", ["hunter2"])).toBe(
      "token is *** ok",
    );
  });

  it("masks every occurrence, including across newlines", () => {
    const text = "key=s3cret\nagain s3cret\nand s3cret here";
    const out = redactSecrets(text, ["s3cret"]);
    expect(out).toBe("key=***\nagain ***\nand *** here");
    expect(out).not.toContain("s3cret");
  });

  it("masks longest-first so a substring value leaves no leftover", () => {
    // "abc" is a substring of "abcdef"; naive shortest-first would mask the
    // "abc" inside "abcdef" and leave a dangling "def".
    const out = redactSecrets("value abcdef and abc alone", ["abc", "abcdef"]);
    expect(out).toBe("value *** and *** alone");
    expect(out).not.toContain("def");
    expect(out).not.toContain("abc");
  });

  it("matches a value with regex metacharacters literally", () => {
    const secret = "p@ss.w*rd$1+x";
    const out = redactSecrets(`pw=${secret} end`, [secret]);
    expect(out).toBe("pw=*** end");
    expect(out).not.toContain(secret);
  });

  it("does not interpret the value as a regex (no metachar over-match)", () => {
    const secret = "p@ss.w*rd$1+x";
    // If the value were compiled as a real regex, "." would match any char and
    // "w*" would match zero-or-more "w". This decoy differs from the literal
    // secret (note "X" where the secret has ".") so it must survive untouched.
    const decoy = "p@ssXw*rd$1+x";
    const out = redactSecrets(`decoy=${decoy}`, [secret]);
    expect(out).toBe(`decoy=${decoy}`);
    expect(out).toContain(decoy);
  });

  it("skips an empty value (does not mass-mask the output)", () => {
    expect(redactSecrets("nothing secret here", [""])).toBe(
      "nothing secret here",
    );
  });

  it("skips a whitespace-only value (does not mass-mask the output)", () => {
    const text = "leave  the   spaces alone";
    expect(redactSecrets(text, ["   "])).toBe(text);
  });
});

describe("redactSecrets defense-in-depth pattern pack", () => {
  it("redacts connection-string userinfo even with no injected values", () => {
    expect(redactSecrets("connect postgres://u:p@h/db", [])).toBe(
      "connect postgres://***@h/db",
    );
  });

  it("redacts a Bearer token even with no injected values", () => {
    const out = redactSecrets("Authorization: Bearer abcdef12345678", []);
    expect(out).toBe("Authorization: Bearer ***");
    expect(out).not.toContain("abcdef12345678");
  });
});

describe("redactSecrets - encoded forms", () => {
  const SECRET = "testtesttest"; // 12 chars, a realistic vaulted value

  it("redacts base64 of the value (printf-style, exact)", () => {
    const b64 = Buffer.from(SECRET).toString("base64");
    const out = redactSecrets(`token=${b64}`, [SECRET]);
    expect(out).not.toContain(b64);
    expect(out).not.toContain(SECRET);
    expect(out).toContain("***");
  });

  it("redacts base64 of the value with a trailing newline (echo | base64)", () => {
    const b64 = Buffer.from(`${SECRET}\n`).toString("base64");
    const out = redactSecrets(`LEAKTEST=${b64}`, [SECRET]);
    expect(out).not.toContain(b64);
    expect(out).toContain("***");
  });

  it("redacts base64 for a non-3-aligned value length", () => {
    const v = "abcd"; // len 4, not a multiple of 3
    const b64 = Buffer.from(`${v}\n`).toString("base64");
    const out = redactSecrets(`x ${b64} y`, [v]);
    expect(out).not.toContain(b64);
    expect(out).toContain("***");
  });

  it("redacts base64url of the value", () => {
    const b64url = Buffer.from(SECRET)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const out = redactSecrets(`h=${b64url}`, [SECRET]);
    expect(out).not.toContain(b64url);
    expect(out).toContain("***");
  });

  it("redacts hex of the value (xxd-style, with/without trailing newline)", () => {
    const hex = Buffer.from(SECRET).toString("hex");
    const hexNl = Buffer.from(`${SECRET}\n`).toString("hex");
    expect(redactSecrets(`v=${hex}`, [SECRET])).not.toContain(hex);
    expect(redactSecrets(`v=${hexNl}`, [SECRET])).not.toContain(SECRET);
    expect(redactSecrets(`v=${hex}`, [SECRET])).toContain("***");
  });

  it("redacts base32 of the value", () => {
    // base32 of "testtesttest" (RFC 4648, uppercase). Verified by roundtrip:
    // node decode of this string yields "testtesttest".
    const b32 = "ORSXG5DUMVZXI5DFON2A";
    const out = redactSecrets(`v=${b32}`, [SECRET]);
    expect(out).not.toContain(b32);
    expect(out).toContain("***");
  });

  // H6: a lowercase base32 form (the SAME value, `tr A-Z a-z`) previously slipped
  // past the uppercase-only [A-Z2-7] scan. Case-insensitive matching catches it.
  it("redacts a LOWERCASE base32 form of the value (H6)", () => {
    const b32lower = "orsxg5dumvzxi5dfon2a";
    const out = redactSecrets(`v=${b32lower}`, [SECRET]);
    expect(out).not.toContain(b32lower);
    expect(out).toContain("***");
  });

  it("does NOT over-redact an innocent uppercase base32-ish run", () => {
    const innocent = "MAXBUFFERSIZECONSTANT2345"; // not the secret
    const out = redactSecrets(`X=${innocent}`, [SECRET]);
    expect(out).toContain(innocent);
  });

  it("redacts the percent-encoded form", () => {
    const v = "p@ss/w&rd=1!"; // has chars that percent-encode
    const enc = encodeURIComponent(v);
    const out = redactSecrets(`url?x=${enc}`, [v]);
    expect(out).not.toContain(enc);
    expect(out).toContain("***");
  });

  it("does NOT over-redact a base64 blob that lacks the secret", () => {
    const innocent = Buffer.from("hello world, nothing secret here").toString(
      "base64",
    );
    const out = redactSecrets(`data=${innocent}`, [SECRET]);
    expect(out).toContain(innocent); // preserved
  });

  it("does NOT over-redact a hex hash that lacks the secret", () => {
    const sha = "a".repeat(40); // 40-char hex, decodes to non-secret bytes
    const out = redactSecrets(`sha=${sha}`, [SECRET]);
    expect(out).toContain(sha);
  });

  it("still redacts the literal value (existing behavior intact)", () => {
    expect(redactSecrets(`raw ${SECRET} here`, [SECRET])).toBe("raw *** here");
  });

  it("no values -> text unchanged by the encoded pass", () => {
    const b64 = Buffer.from(SECRET).toString("base64");
    expect(redactSecrets(`x ${b64}`, [])).toBe(`x ${b64}`);
  });
});
