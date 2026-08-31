import { describe, expect, it } from "vitest";
import { decodeTerminalEscapes } from "./terminalEscapes";

describe("decodeTerminalEscapes", () => {
  it("submits a line an agent escaped as literal text", () => {
    // The bug: `\rATLASPROBE ...` sat unsent at a prompt because the two
    // characters backslash and r were written to the pty instead of a CR.
    expect(decodeTerminalEscapes("\\rATLASPROBE hello")).toBe(
      "\rATLASPROBE hello",
    );
    expect(decodeTerminalEscapes("git status\\n")).toBe("git status\n");
  });

  it("leaves a REAL newline untouched, so a correct call is unaffected", () => {
    // Decoding must be safe to apply to every send, including the ones that
    // were already right.
    expect(decodeTerminalEscapes("git status\n")).toBe("git status\n");
    expect(decodeTerminalEscapes("echo hi\r")).toBe("echo hi\r");
  });

  it("decodes the interrupt the tool description names", () => {
    expect(decodeTerminalEscapes("\\u0003")).toBe("\u0003");
    expect(decodeTerminalEscapes("\\x03")).toBe("\u0003");
  });

  it("keeps a literal backslash expressible", () => {
    // \\ consumes its own backslash, so this is a backslash then an n -- NOT a
    // newline. Without that, no caller could ever type a backslash.
    expect(decodeTerminalEscapes("\\\\n")).toBe("\\n");
    expect(decodeTerminalEscapes("C:\\\\Users")).toBe("C:\\Users");
  });

  it("passes through text with no backslash at all, unchanged", () => {
    const s = "npm test -- --run";
    expect(decodeTerminalEscapes(s)).toBe(s);
  });

  it("leaves an UNKNOWN escape exactly as written", () => {
    // Terminal input is arbitrary text. Inventing a meaning for \q would
    // corrupt a real payload that happens to contain it.
    expect(decodeTerminalEscapes("find . -name \\*.ts")).toBe(
      "find . -name \\*.ts",
    );
    expect(decodeTerminalEscapes("\\q")).toBe("\\q");
  });

  it("leaves a malformed hex escape alone rather than guessing", () => {
    expect(decodeTerminalEscapes("\\xZZ")).toBe("\\xZZ");
    expect(decodeTerminalEscapes("\\u00")).toBe("\\u00");
  });

  it("handles a trailing lone backslash without dropping it", () => {
    expect(decodeTerminalEscapes("echo \\")).toBe("echo \\");
  });

  it("decodes several escapes in one payload", () => {
    expect(decodeTerminalEscapes("a\\tb\\nc")).toBe("a\tb\nc");
  });
});
