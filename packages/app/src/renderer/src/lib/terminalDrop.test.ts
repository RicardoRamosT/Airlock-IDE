import { describe, expect, it } from "vitest";
import { shellQuotePath, terminalDropText } from "./terminalDrop";

describe("shellQuotePath", () => {
  it("leaves a safe path unquoted", () => {
    expect(shellQuotePath("/Users/me/proj/file.png")).toBe(
      "/Users/me/proj/file.png",
    );
  });
  it("quotes a path containing spaces", () => {
    expect(shellQuotePath("/Users/me/my docs/a.pdf")).toBe(
      "'/Users/me/my docs/a.pdf'",
    );
  });
  it("escapes an embedded single quote (POSIX '\\'' form)", () => {
    expect(shellQuotePath("/tmp/it's here.txt")).toBe(
      "'/tmp/it'\\''s here.txt'",
    );
  });
  it("quotes an empty string", () => {
    expect(shellQuotePath("")).toBe("''");
  });
});

describe("terminalDropText", () => {
  it("returns one path with a trailing space", () => {
    expect(terminalDropText(["/a/b.png"])).toBe("/a/b.png ");
  });
  it("space-joins multiple paths, quoting only those that need it", () => {
    expect(terminalDropText(["/a/b.png", "/c/d e.pdf"])).toBe(
      "/a/b.png '/c/d e.pdf' ",
    );
  });
  it("filters empty entries and returns null when nothing remains", () => {
    expect(terminalDropText(["", ""])).toBeNull();
    expect(terminalDropText([])).toBeNull();
  });
});
