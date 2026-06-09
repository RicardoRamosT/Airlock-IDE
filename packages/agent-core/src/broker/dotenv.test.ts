import { describe, expect, it } from "vitest";
import { parseDotEnv } from "./dotenv";

describe("parseDotEnv", () => {
  it("parses plain pairs, skipping comments and blanks", () => {
    const text = ["# comment", "", "FOO=bar", "BAZ=qux"].join("\n");
    expect(parseDotEnv(text)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("handles export prefix and surrounding whitespace", () => {
    expect(parseDotEnv("export KEY = value")).toEqual({ KEY: "value" });
  });

  it("unquotes double quotes and unescapes newlines", () => {
    expect(parseDotEnv('PEM="line1\\nline2"')).toEqual({ PEM: "line1\nline2" });
  });

  it("unescapes \\t and \\n inside double quotes", () => {
    // File content is: A="x\ty\nz" (single backslashes before t and n).
    // The TS literal doubles each backslash; the parser must turn \t and \n
    // into a real tab and real newline.
    expect(parseDotEnv('A="x\\ty\\nz"')).toEqual({ A: "x\ty\nz" });
  });

  it("treats \\\\n as a literal backslash + n, not a newline", () => {
    // File content is: A="\\n" (backslash, backslash, n). The leading \\ is
    // the escape for one backslash; the trailing n stays literal. Result is
    // two characters: backslash + n -- NOT a newline.
    expect(parseDotEnv('A="\\\\n"')).toEqual({ A: "\\n" });
    // And \r maps to a carriage return.
    expect(parseDotEnv('A="a\\rb"')).toEqual({ A: "a\rb" });
  });

  it("collapses an escaped backslash pair to a single backslash", () => {
    // File content is: A="\\" (two backslashes) -> one literal backslash.
    expect(parseDotEnv('A="\\\\"')).toEqual({ A: "\\" });
  });

  it("unquotes single quotes literally", () => {
    expect(parseDotEnv("A='has \\n literal'")).toEqual({
      A: "has \\n literal",
    });
  });

  it("strips trailing comments from unquoted values only", () => {
    expect(parseDotEnv("A=value # note")).toEqual({ A: "value" });
    expect(parseDotEnv('B="value # not a comment"')).toEqual({
      B: "value # not a comment",
    });
  });

  it("ignores malformed lines and invalid names", () => {
    expect(parseDotEnv("not a pair\n1BAD=x\nGOOD=1")).toEqual({ GOOD: "1" });
  });

  it("keeps the last occurrence of duplicate keys", () => {
    expect(parseDotEnv("A=1\nA=2")).toEqual({ A: "2" });
  });

  // L6: a "__proto__" key must become a normal OWN property, not mutate the
  // prototype -- otherwise it is dropped from Object.entries and importDotEnv
  // silently loses it (and may then delete the .env). Also guards against
  // prototype pollution from a hostile .env.
  it("captures __proto__ as an own key without polluting the prototype (L6)", () => {
    const out = parseDotEnv("__proto__=evil\nNORMAL=ok");
    expect(Object.keys(out)).toContain("__proto__");
    expect(out.NORMAL).toBe("ok");
    expect(Object.getPrototypeOf(out)).toBeNull();
    // a fresh object is unaffected (no pollution)
    expect(({} as Record<string, unknown>).evil).toBeUndefined();
  });
});
