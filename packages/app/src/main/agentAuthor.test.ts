import { describe, expect, it } from "vitest";
import {
  AGENT_SIGNATURES,
  authorFromHeaders,
  SIGN_MIN_WORDS,
  signAgentInput,
} from "./agentAuthor";

const sign = (s: string) => signAgentInput(s, "atlas");
const SIG = AGENT_SIGNATURES.atlas;

describe("signAgentInput", () => {
  it("signs a dispatched sentence, on the same line as the text", () => {
    // The signature rides the SAME submission. Put after the trailing newline
    // it would arrive as a second prompt of its own, and the receiving Claude
    // would answer the signature.
    expect(sign("Fix the two defects and commit them separately.\n")).toBe(
      `Fix the two defects and commit them separately. ${SIG}\n`,
    );
  });

  it("is inert in a shell, because it is a comment", () => {
    // A signed payload can land in a shell rather than a Claude session. As a
    // `#` comment the command still runs and the signature does not.
    expect(SIG.startsWith("#")).toBe(true);
    expect(sign("git commit -m 'fix the atlas activity wiring'\n")).toContain(
      " #",
    );
  });

  it("leaves a keystroke alone", () => {
    // Ctrl-C. Appending anything here would be corruption, not attribution.
    expect(sign("\u0003")).toBe("\u0003");
  });

  it("leaves a short answer alone", () => {
    expect(sign("y\n")).toBe("y\n");
    expect(sign("2\n")).toBe("2\n");
  });

  it("leaves a bare path alone however long it is", () => {
    // The discriminator is WORDS, not length: an interactive answer is one
    // token, and a long path would sail past any character threshold.
    const p = "/Users/someone/Projects/airlock/packages/app/src/main/ipc.ts\n";
    expect(sign(p)).toBe(p);
  });

  it("leaves an unsubmitted fragment alone", () => {
    // Nothing has been dispatched yet -- this is typing, not sending.
    expect(sign("Fix the two defects and commit them separately.")).toBe(
      "Fix the two defects and commit them separately.",
    );
  });

  it("signs the last line of a multi-line dispatch, once", () => {
    const out = sign("Two defects.\nFix both and commit them separately.\n");
    expect(out).toBe(
      `Two defects.\nFix both and commit them separately. ${SIG}\n`,
    );
    expect(out.split(SIG)).toHaveLength(2);
  });

  it("straddles the word floor", () => {
    const under = `${"word ".repeat(SIGN_MIN_WORDS - 1).trim()}\n`;
    const at = `${"word ".repeat(SIGN_MIN_WORDS).trim()}\n`;
    expect(sign(under)).toBe(under);
    expect(sign(at)).toContain(SIG);
  });

  it("never signs twice", () => {
    const once = sign("Fix the two defects and commit them separately.\n");
    expect(sign(once)).toBe(once);
  });

  it("does nothing without an author", () => {
    const s = "Fix the two defects and commit them separately.\n";
    expect(signAgentInput(s, null)).toBe(s);
  });

  it("preserves a CRLF submit", () => {
    expect(sign("Fix the two defects and commit them.\r\n")).toBe(
      `Fix the two defects and commit them. ${SIG}\r\n`,
    );
  });
});

describe("authorFromHeaders", () => {
  it("reads Atlas's marker, whatever the header case", () => {
    expect(authorFromHeaders({ "x-airlock-author": "atlas" })).toBe("atlas");
    expect(authorFromHeaders({ "X-Airlock-Author": "Atlas" })).toBe("atlas");
  });

  it("is null for a caller that claims nothing", () => {
    // A project's own Claude. Its terminal input is unsigned today -- the
    // confusion this fixes is Atlas writing in the user's voice ACROSS
    // projects.
    expect(authorFromHeaders({})).toBeNull();
  });

  it("is null for an unknown author, not a passthrough", () => {
    // The author decides a signature's WORDING, so it can only ever be one of
    // ours. An arbitrary string must never reach the pty.
    expect(authorFromHeaders({ "x-airlock-author": "root" })).toBeNull();
    expect(authorFromHeaders({ "x-airlock-author": ["atlas"] })).toBeNull();
  });
});
