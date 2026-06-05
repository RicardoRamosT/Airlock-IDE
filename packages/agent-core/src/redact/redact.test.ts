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
