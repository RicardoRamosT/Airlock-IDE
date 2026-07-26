import { describe, expect, it } from "vitest";
import {
  avatarHue,
  dayKey,
  formatDayLabel,
  formatSlackTime,
  initialsFor,
} from "./slackFormat";

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

describe("formatDayLabel", () => {
  const now = new Date(2026, 6, 26, 12, 0, 0);

  it("labels today and yesterday in words", () => {
    expect(formatDayLabel(tsFor(new Date(2026, 6, 26, 1, 0)), now)).toBe(
      "Today",
    );
    expect(formatDayLabel(tsFor(new Date(2026, 6, 25, 23, 0)), now)).toBe(
      "Yesterday",
    );
  });

  it("labels an older day in this year without the year", () => {
    expect(formatDayLabel(tsFor(new Date(2026, 6, 20, 9, 0)), now)).toBe(
      "Jul 20",
    );
  });

  it("includes the year for a different year", () => {
    expect(formatDayLabel(tsFor(new Date(2025, 6, 20, 9, 0)), now)).toBe(
      "Jul 20 2025",
    );
  });

  it("crosses midnight correctly (yesterday, not 'Today')", () => {
    const justAfterMidnight = new Date(2026, 6, 26, 0, 10, 0);
    expect(
      formatDayLabel(tsFor(new Date(2026, 6, 25, 23, 50)), justAfterMidnight),
    ).toBe("Yesterday");
  });

  it("is empty for an unparseable ts", () => {
    expect(formatDayLabel("nope", now)).toBe("");
  });
});

describe("dayKey", () => {
  it("matches for two times on the same day and differs across days", () => {
    const a = tsFor(new Date(2026, 6, 26, 1, 0));
    const b = tsFor(new Date(2026, 6, 26, 23, 0));
    const c = tsFor(new Date(2026, 6, 25, 23, 0));
    expect(dayKey(a)).toBe(dayKey(b));
    expect(dayKey(a)).not.toBe(dayKey(c));
  });
});

describe("initialsFor", () => {
  it("takes up to two initials", () => {
    expect(initialsFor("Ricardo Ramos Treviño")).toBe("RR");
    expect(initialsFor("Slackbot")).toBe("S");
  });

  it("strips the (DM)/(group) suffix the allow-list adds", () => {
    expect(initialsFor("Ricardo Ramos Treviño (DM)")).toBe("RR");
    expect(initialsFor("alice, bob (group)")).toBe("AB");
  });

  it("falls back to ? for an empty name", () => {
    expect(initialsFor("")).toBe("?");
    expect(initialsFor("   ")).toBe("?");
  });

  it("handles a non-ASCII first letter", () => {
    expect(initialsFor("Ángela")).toBe("Á");
  });
});

describe("avatarHue", () => {
  it("is stable for the same seed and in range", () => {
    const h = avatarHue("U0BF0KLPNP3");
    expect(h).toBe(avatarHue("U0BF0KLPNP3"));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });

  it("generally differs between different seeds", () => {
    expect(avatarHue("U1")).not.toBe(avatarHue("U2"));
  });
});
