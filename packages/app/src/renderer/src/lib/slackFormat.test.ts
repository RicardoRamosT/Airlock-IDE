import { describe, expect, it } from "vitest";
import { formatSlackTime } from "./slackFormat";

// Slack ts is "<epoch seconds>.<counter>". Build expectations from the LOCAL
// clock so the test is timezone-independent.
function tsFor(d: Date): string {
  return `${Math.floor(d.getTime() / 1000)}.000100`;
}

describe("formatSlackTime", () => {
  it("shows HH:MM for a message from today", () => {
    const now = new Date(2026, 6, 26, 18, 0, 0);
    const msg = new Date(2026, 6, 26, 9, 5, 0);
    expect(formatSlackTime(tsFor(msg), now)).toBe("09:05");
  });

  it("pads single-digit hours and minutes", () => {
    const now = new Date(2026, 6, 26, 18, 0, 0);
    const msg = new Date(2026, 6, 26, 7, 3, 0);
    expect(formatSlackTime(tsFor(msg), now)).toBe("07:03");
  });

  it("shows a date for a message from an earlier day", () => {
    const now = new Date(2026, 6, 26, 0, 30, 0);
    const msg = new Date(2026, 6, 25, 23, 45, 0);
    expect(formatSlackTime(tsFor(msg), now)).toBe("Jul 25");
  });

  it("treats the same clock time on a different YEAR as a date", () => {
    const now = new Date(2026, 6, 26, 12, 0, 0);
    const msg = new Date(2025, 6, 26, 12, 0, 0);
    expect(formatSlackTime(tsFor(msg), now)).toBe("Jul 26");
  });

  it("returns an empty string for an unparseable ts rather than NaN", () => {
    expect(formatSlackTime("", new Date())).toBe("");
    expect(formatSlackTime("not-a-ts", new Date())).toBe("");
  });
});
