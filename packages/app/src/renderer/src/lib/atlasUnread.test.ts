import { expect, it } from "vitest";
import { isUnread } from "./atlasUnread";

it("is unread when today's brief is newer than the last one read", () => {
  expect(isUnread({ day: "2026-08-30" }, true, "2026-08-29")).toBe(true);
});

it("CLEARS once that day has been read", () => {
  // The bug this pins: the old test was `brief !== null`, so the dot could
  // never turn off and was permanently lit.
  expect(isUnread({ day: "2026-08-30" }, true, "2026-08-30")).toBe(false);
});

it("is unread when nothing has ever been read", () => {
  expect(isUnread({ day: "2026-08-30" }, true, "")).toBe(true);
});

it("is never unread with no brief", () => {
  expect(isUnread(null, true, "")).toBe(false);
});

it("is never unread before consent, since Atlas has not run", () => {
  expect(isUnread({ day: "2026-08-30" }, false, "")).toBe(false);
});

it("stays clear if the last read day is somehow ahead of the brief", () => {
  // A clock change must not relight the dot for an older brief.
  expect(isUnread({ day: "2026-08-29" }, true, "2026-08-30")).toBe(false);
});
