import { expect, it } from "vitest";
import type { AtlasFact } from "./facts";
import {
  isStale,
  pickDailyQuestion,
  questionFor,
  STALE_AFTER_DAYS,
} from "./staleness";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 30, 9, 0, 0);

const fact = (over: Partial<AtlasFact> = {}): AtlasFact => ({
  id: "f0",
  project: "ezlis",
  kind: "status",
  value: "dead",
  verbatim: "ezlis is dead",
  saidAt: NOW - (STALE_AFTER_DAYS + 1) * DAY,
  supersededAt: null,
  ...over,
});

it("treats a fact older than the horizon as stale", () => {
  expect(isStale(fact(), NOW)).toBe(true);
});

it("treats a recent fact as fresh", () => {
  expect(isStale(fact({ saidAt: NOW - DAY }), NOW)).toBe(false);
});

it("never treats a superseded fact as stale, since it is already replaced", () => {
  expect(isStale(fact({ supersededAt: NOW - DAY }), NOW)).toBe(false);
});

it("picks the oldest stale fact to ask about", () => {
  const older = fact({ id: "old", saidAt: NOW - 400 * DAY });
  const newer = fact({ id: "new", saidAt: NOW - (STALE_AFTER_DAYS + 2) * DAY });
  expect(pickDailyQuestion([newer, older], NOW, null, "2026-08-30")?.id).toBe(
    "old",
  );
});

it("asks nothing when no fact is stale", () => {
  expect(
    pickDailyQuestion([fact({ saidAt: NOW })], NOW, null, "2026-08-30"),
  ).toBeNull();
});

it("asks nothing when a question was already asked today", () => {
  // At most one per day. Two makes it an interrogation rather than a
  // conversation, which is exactly what the user asked Atlas not to be.
  expect(
    pickDailyQuestion([fact()], NOW, "2026-08-30", "2026-08-30"),
  ).toBeNull();
});

it("asks again on the next day", () => {
  expect(
    pickDailyQuestion([fact()], NOW, "2026-08-29", "2026-08-30"),
  ).not.toBeNull();
});

it("asks nothing when there are no facts at all", () => {
  expect(pickDailyQuestion([], NOW, null, "2026-08-30")).toBeNull();
});

it("phrases the question using the user's own words and how long ago", () => {
  const q = questionFor(fact({ saidAt: NOW - 90 * DAY }), NOW);
  expect(q).toContain("ezlis is dead");
  expect(q).toMatch(/90 days|3 months/);
  expect(q).toMatch(/\?$/);
});
