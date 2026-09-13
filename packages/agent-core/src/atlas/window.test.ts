import { describe, expect, it } from "vitest";
import { debriefWindow, WINDOW_CAP_MS, WINDOW_FLOOR_MS } from "./window";

const NOW = Date.UTC(2026, 8, 12, 9, 0, 0);
const hours = (n: number) => n * 60 * 60 * 1000;

describe("debriefWindow", () => {
  it("covers the last 24h when there has never been a brief", () => {
    const w = debriefWindow(null, NOW);
    expect(w.sinceMs).toBe(NOW - WINDOW_FLOOR_MS);
    expect(w.untilMs).toBe(NOW);
    expect(w.capped).toBe(false);
  });

  it("runs from the last brief when more than a day has passed", () => {
    const last = NOW - hours(72);
    expect(debriefWindow(last, NOW).sinceMs).toBe(last);
  });

  it("floors at 24h so a same-day re-run still covers yesterday", () => {
    // The whole point: a second debrief at lunchtime must not report on a
    // three-hour window and call the morning's work the whole day.
    const w = debriefWindow(NOW - hours(3), NOW);
    expect(w.sinceMs).toBe(NOW - WINDOW_FLOOR_MS);
    expect(w.capped).toBe(false);
  });

  it("caps a long absence and says so", () => {
    const w = debriefWindow(NOW - hours(24 * 90), NOW);
    expect(w.sinceMs).toBe(NOW - WINDOW_CAP_MS);
    expect(w.capped).toBe(true);
  });

  it("treats a future last-brief as no last brief", () => {
    // Clock change or timezone move. Same defence as shouldCompose's strict
    // less-than on day keys: never produce a negative or inverted window.
    const w = debriefWindow(NOW + hours(5), NOW);
    expect(w.sinceMs).toBe(NOW - WINDOW_FLOOR_MS);
    expect(w.capped).toBe(false);
  });
});
