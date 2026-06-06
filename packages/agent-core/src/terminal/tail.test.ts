import { describe, expect, it } from "vitest";
import {
  cleanTerminalOutput,
  lastLines,
  previewLines,
  redactedPreview,
  redactedTail,
} from "./tail";

describe("cleanTerminalOutput", () => {
  it("strips ANSI color codes", () => {
    expect(cleanTerminalOutput("\x1b[32mok\x1b[0m done")).toBe("ok done");
  });
  it("strips OSC title sequences", () => {
    expect(cleanTerminalOutput("\x1b]0;a title\x07hello")).toBe("hello");
  });
  it("strips OSC sequences terminated by ST (ESC backslash)", () => {
    expect(cleanTerminalOutput("\x1b]0;title\x1b\\hello")).toBe("hello");
  });
  it("collapses carriage-return overwrites to the last write", () => {
    expect(cleanTerminalOutput("loading 10%\rloading 100%")).toBe(
      "loading 100%",
    );
  });
  it("normalizes CRLF to newlines", () => {
    expect(cleanTerminalOutput("a\r\nb")).toBe("a\nb");
  });
  it("leaves plain text untouched", () => {
    expect(cleanTerminalOutput("plain text")).toBe("plain text");
  });
});

describe("lastLines", () => {
  it("returns the last n lines", () => {
    expect(lastLines("a\nb\nc\nd", 2)).toBe("c\nd");
  });
  it("drops a single trailing empty line", () => {
    expect(lastLines("a\nb\n", 2)).toBe("a\nb");
  });
  it("returns all when n exceeds length", () => {
    expect(lastLines("a\nb", 10)).toBe("a\nb");
  });
  it("returns empty for n <= 0", () => {
    expect(lastLines("a\nb", 0)).toBe("");
  });
});

describe("previewLines", () => {
  it("returns the last n non-empty lines", () => {
    expect(previewLines("x\n\n\ny\nz\n", 2)).toBe("y\nz");
  });
  it("skips blank lines", () => {
    expect(previewLines("\n\n  \nhello\n", 3)).toBe("hello");
  });
});

describe("redactedTail (security-critical)", () => {
  it("redacts a secret value that appears in the buffer", () => {
    const raw = "\x1b[32mconnecting\x1b[0m postgres://u:supersecret@host/db\n";
    const out = redactedTail(raw, ["supersecret"], 10);
    expect(out).not.toContain("supersecret");
    expect(out).toContain("***");
  });
  it("returns the last n cleaned lines", () => {
    expect(redactedTail("a\nb\nc\n", [], 2)).toBe("b\nc");
  });
});

describe("redactedPreview", () => {
  it("redacts and returns the last n non-empty lines", () => {
    expect(redactedPreview("\n\nhello secret\n", ["secret"], 1)).toBe(
      "hello ***",
    );
  });
});
