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
});
