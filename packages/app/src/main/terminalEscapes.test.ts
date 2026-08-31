import { describe, expect, it } from "vitest";
import { decodeTerminalEscapes, splitSubmit } from "./terminalEscapes";

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

describe("splitSubmit", () => {
  it("separates the text to TYPE from the Enter that sends it", () => {
    // A running Claude reads with bracketed paste: a carriage return inside one
    // arriving chunk is a line break in the composer, not Enter. So the submit
    // has to be its own write -- `git status\r` in one chunk was typed and
    // never sent, twice, on 2026-08-31.
    expect(splitSubmit("git status\n")).toEqual({
      body: "git status",
      submit: "\r",
    });
    expect(splitSubmit("git status\r")).toEqual({
      body: "git status",
      submit: "\r",
    });
  });

  it("treats a bare newline as Enter with nothing to type", () => {
    expect(splitSubmit("\n")).toEqual({ body: "", submit: "\r" });
  });

  it("keeps interior newlines in the body, stripping only the submit", () => {
    expect(splitSubmit("line one\nline two\n")).toEqual({
      body: "line one\nline two",
      submit: "\r",
    });
  });

  it("does not invent a submit that was not asked for", () => {
    // No trailing newline means the agent is typing WITHOUT sending, which the
    // tool supports on purpose.
    expect(splitSubmit("partial")).toEqual({ body: "partial", submit: null });
    expect(splitSubmit("")).toEqual({ body: "", submit: null });
    expect(splitSubmit("\u0003")).toEqual({ body: "\u0003", submit: null });
  });

  it("collapses a CRLF, so Enter is pressed once", () => {
    expect(splitSubmit("done\r\n")).toEqual({ body: "done", submit: "\r" });
  });

  it("composes with escape decoding, in that order", () => {
    expect(splitSubmit(decodeTerminalEscapes("git status\\n"))).toEqual({
      body: "git status",
      submit: "\r",
    });
  });
});
