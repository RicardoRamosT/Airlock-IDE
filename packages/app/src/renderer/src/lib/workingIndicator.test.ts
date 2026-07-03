import { describe, expect, it } from "vitest";
import { hasReadyIndicator, hasWorkingIndicator } from "./workingIndicator";

describe("hasWorkingIndicator", () => {
  it("matches the full working footer (wide terminal)", () => {
    expect(
      hasWorkingIndicator(
        "auto mode on (shift+tab to cycle) · esc to interrupt",
      ),
    ).toBe(true);
  });

  // The split-pane bug: a narrow pane makes Claude truncate its own footer, so
  // the buffer holds "esc to interru..." and an exact "interrupt" match failed.
  it("matches a width-truncated footer in a narrow split pane", () => {
    expect(hasWorkingIndicator("· esc to interru…")).toBe(true);
    expect(hasWorkingIndicator("esc to interru...")).toBe(true);
    expect(hasWorkingIndicator("· esc to inter…")).toBe(true);
  });

  it("matches a wrapped (multi-line) footer after whitespace collapse", () => {
    expect(hasWorkingIndicator("esc to\n   interrupt")).toBe(true);
  });

  it("is false when idle / no working footer", () => {
    expect(hasWorkingIndicator("ricardoramos@Mac ~ %")).toBe(false);
    expect(hasWorkingIndicator("? for shortcuts")).toBe(false);
    // Idle hint that shares the "esc to" prefix but is NOT the working footer.
    expect(hasWorkingIndicator("esc to clear")).toBe(false);
    expect(hasWorkingIndicator("")).toBe(false);
  });

  // Claude Code v2.1.x rotates the footer's hint segment, so "esc to
  // interrupt" is absent for long stretches while a spinner line like
  // "· Burrowing… (3s · ↓ 45 tokens · thinking with xhigh effort)" is shown.
  // The matcher must hit the stable core every rotation keeps: spinner glyph +
  // verb + "… (" + elapsed.
  it("matches the v2 rotating status line without the esc hint", () => {
    expect(
      hasWorkingIndicator(
        "· Burrowing… (3s · ↓ 45 tokens · thinking with xhigh effort)",
      ),
    ).toBe(true);
    expect(hasWorkingIndicator("✳ Churning… (12s · ↓ 1.2k tokens)")).toBe(true);
    expect(hasWorkingIndicator("✻ Reticulating… (83s)")).toBe(true);
    // Narrow split pane truncates the tail; the core stays intact.
    expect(hasWorkingIndicator("· Burrowing… (3s · ↓ 45 to…")).toBe(true);
    // Wrapped across buffer rows; caller joins rows, matcher collapses.
    expect(hasWorkingIndicator("∗ Cerebrating…\n  (7s · thinking)")).toBe(true);
  });

  // v2.1.185: the spinner glyph rotated to frames OUTSIDE the old hard-coded set
  // (captured live: "✦/+ Sautéing… (7s · thinking with xhigh effort)"; tab titles
  // showed braille "⠂"), and the hint rotated to "thinking with xhigh effort"
  // (no "esc to interrupt"). The dot must still light off the glyph-independent
  // core ("<verb>… (<N>s"), regardless of which spinner frame is showing.
  it("matches v2.1.185 footers regardless of the spinner glyph", () => {
    expect(
      hasWorkingIndicator("✦ Sautéing… (7s · thinking with xhigh effort)"),
    ).toBe(true);
    expect(
      hasWorkingIndicator("+ Sautéing… (7s · thinking with xhigh effort)"),
    ).toBe(true);
    expect(hasWorkingIndicator("⠂ Frobnicating… (2s)")).toBe(true);
  });

  // Claude Code 2.1.199 dropped BOTH "esc to interrupt" AND the "…" after the
  // verb (verified: 0 occurrences of either in the 2.1.199 binary), so the
  // footer is now "<glyph> <Verb> (<Ns> · ↓ <N> tokens · …)" -- no ellipsis. The
  // dot must still light off the one invariant every version keeps: the
  // parenthetical live elapsed timer "(<N>s" (with optional minutes/hours).
  it("matches 2.1.199 footers that dropped the … and the esc hint", () => {
    expect(hasWorkingIndicator("✻ Frolicking (12s · ↓ 1.2k tokens)")).toBe(true);
    expect(
      hasWorkingIndicator("✻ Cerebrating (1m 5s · ↑ 2.3k tokens · thinking)"),
    ).toBe(true);
    expect(hasWorkingIndicator("✻ Simmering (45s)")).toBe(true);
    // Narrow split truncates the tail; the "(Ns" anchor stays intact.
    expect(hasWorkingIndicator("✻ Frolicking (12s · ↓ 1.2…")).toBe(true);
  });

  it("does not match finished/idle lines that share the spinner glyphs", () => {
    // Finished summary: glyph + past-tense verb, but no "… (Ns" core.
    expect(hasWorkingIndicator("✳ Churned for 6s")).toBe(false);
    // A bare duration WITHOUT the footer's paren is not the working timer.
    expect(hasWorkingIndicator("Compiled in 2s")).toBe(false);
    // Response bullet text.
    expect(hasWorkingIndicator("⏺ I'm here and working.")).toBe(false);
    // Idle footer hints with midline separators and parens but no elapsed.
    expect(
      hasWorkingIndicator("auto mode on (shift+tab to cycle) · ← for agents"),
    ).toBe(false);
    expect(hasWorkingIndicator("Image in clipboard · ctrl+v to paste")).toBe(
      false,
    );
  });
});

describe("hasReadyIndicator", () => {
  it("is true when the shift+tab cycling footer is on screen", () => {
    expect(hasReadyIndicator("» auto mode on (shift+tab to cycle)")).toBe(true);
  });

  it("is true when the ? for shortcuts footer is on screen", () => {
    expect(hasReadyIndicator("? for shortcuts")).toBe(true);
  });

  it("is false for a bare shell prompt", () => {
    expect(hasReadyIndicator("ricardoramos@Mac ~ %")).toBe(false);
  });

  it("is false for an empty string", () => {
    expect(hasReadyIndicator("")).toBe(false);
  });
});
