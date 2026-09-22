import { describe, expect, it } from "vitest";
import { ticketLine } from "./updateTicket";

// Dates are built in LOCAL time and formatted in local time, so these assertions
// hold in any timezone.
const at = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m, d, h, min).getTime();

const NOW = at(2026, 8, 21, 12, 15); // Mon 21 Sep 2026, 12:15 local

describe("ticketLine", () => {
  it("shows the clock time for a build made today", () => {
    expect(ticketLine("0.7.0", at(2026, 8, 21, 11, 42), NOW)).toBe(
      "0.7.0 · built 11:42",
    );
  });

  it("pads a single-digit hour and minute", () => {
    expect(ticketLine("0.7.0", at(2026, 8, 21, 9, 5), NOW)).toBe(
      "0.7.0 · built 09:05",
    );
  });

  it("shows the DATE once the build is no longer today", () => {
    // "built 11:42" on a build from yesterday reads as minutes ago.
    expect(ticketLine("0.7.0", at(2026, 8, 20, 11, 42), NOW)).toBe(
      "0.7.0 · built Sep 20",
    );
  });

  it("shows the version alone on the release path, where there is no build time", () => {
    expect(ticketLine("0.7.0", null, NOW)).toBe("0.7.0");
    expect(ticketLine("0.6.1", undefined, NOW)).toBe("0.6.1");
  });

  it("never renders an empty line when the version is missing", () => {
    expect(ticketLine(null, null, NOW)).toBe("unknown");
    expect(ticketLine(null, at(2026, 8, 21, 11, 42), NOW)).toBe(
      "unknown · built 11:42",
    );
  });

  it("ignores an unusable timestamp rather than printing a bogus date", () => {
    expect(ticketLine("0.7.0", 0, NOW)).toBe("0.7.0");
    expect(ticketLine("0.7.0", Number.NaN, NOW)).toBe("0.7.0");
  });
});
