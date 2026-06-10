import { describe, expect, it } from "vitest";
import { hasWorkingIndicator } from "./workingIndicator";

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

  it("does not match finished/idle lines that share the spinner glyphs", () => {
    // Finished summary: glyph + past-tense verb, but no "… (Ns" core.
    expect(hasWorkingIndicator("✳ Churned for 6s")).toBe(false);
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
