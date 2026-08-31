import { spawnSync } from "node:child_process";
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
      `${SIG} Fix the two defects and commit them separately.\n`,
    );
  });

  it("is inert in a REAL shell, run rather than asserted", () => {
    // This test used to assert `SIG.startsWith("#")` and call that inert. It is
    // not: zsh leaves INTERACTIVE_COMMENTS off by default, so every signed
    // command died with `zsh: parse error near #` (2026-08-31). Claiming shell
    // behaviour without executing a shell is what let that ship, so this runs
    // one -- in both zsh and bash, with -f/--norc so a user's config cannot
    // make it pass.
    const payload = sign("echo running the tests and report\n").trimEnd();
    for (const [shell, noRc] of [
      ["zsh", "-f"],
      ["bash", "--norc"],
    ] as const) {
      const r = spawnSync(shell, [noRc, "-c", payload], { encoding: "utf8" });
      expect(`${shell}: ${r.stderr}`).not.toMatch(/parse error|syntax error/i);
      expect(`${shell}: ${r.status}`).toBe(`${shell}: 0`);
    }
  });

  it("does not swallow the command it prefixes", () => {
    // Inert must not mean inert for the payload too: the signature runs, then
    // the real command runs.
    const payload = sign(
      "echo the-command-still-ran and more words\n",
    ).trimEnd();
    const r = spawnSync("zsh", ["-f", "-c", payload], { encoding: "utf8" });
    expect(r.stdout).toContain("the-command-still-ran");
  });

  it("carries no character a shell would expand", () => {
    // Single-quoted, and the wording is apostrophe-free so it can stay that
    // way. A stray apostrophe would end the quoting and change what runs.
    expect(SIG).not.toContain("`");
    expect(SIG).not.toContain("$");
    expect(SIG).not.toContain("!");
    expect(SIG.split("'").length - 1).toBe(2); // exactly the opening and closing quote
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
      `Two defects.\n${SIG} Fix both and commit them separately.\n`,
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
      `${SIG} Fix the two defects and commit them.\r\n`,
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
