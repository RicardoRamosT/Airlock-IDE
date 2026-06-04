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
});
