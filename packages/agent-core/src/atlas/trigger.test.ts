import { expect, it } from "vitest";
import { shouldCompose, type TriggerState } from "./trigger";

const state = (over: Partial<TriggerState> = {}): TriggerState => ({
  enabled: true,
  acknowledged: true,
  lastBriefDay: "2026-08-29",
  today: "2026-08-30",
  composing: false,
  ...over,
});

it("composes on the first focus of a new day", () => {
  expect(shouldCompose(state())).toBe(true);
});

it("does not compose again once today's brief exists", () => {
  // Focus fires constantly as the user switches apps. Exactly one compose.
  expect(shouldCompose(state({ lastBriefDay: "2026-08-30" }))).toBe(false);
});

it("composes for a first-run user who has never had a brief", () => {
  expect(shouldCompose(state({ lastBriefDay: null }))).toBe(true);
});

it("never composes when the feature is off", () => {
  expect(shouldCompose(state({ enabled: false }))).toBe(false);
});

it("never composes before the user has accepted the cost disclosure", () => {
  // Spec 15.2: opt-in on first run, because an API-key user pays real money.
  expect(shouldCompose(state({ acknowledged: false }))).toBe(false);
});

it("does not start a second compose while one is running", () => {
  // Focus can fire several times in a second while a compose is in flight.
  expect(shouldCompose(state({ composing: true }))).toBe(false);
});

it("composes again after the clock rolls past midnight", () => {
  expect(
    shouldCompose(state({ lastBriefDay: "2026-08-30", today: "2026-08-31" })),
  ).toBe(true);
});

it("does not compose if the stored day is somehow in the future", () => {
  // A clock change or timezone move must not cause a compose loop.
  expect(
    shouldCompose(state({ lastBriefDay: "2026-09-01", today: "2026-08-30" })),
  ).toBe(false);
});
