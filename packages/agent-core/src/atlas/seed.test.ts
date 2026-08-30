import { expect, it } from "vitest";
import { seedRoots } from "./seed";

it("returns open tab roots first, then recents", () => {
  // Open tabs are the strongest signal of what the user works on right now.
  const out = seedRoots(["/p/recent"], ["/p/open"]);
  expect(out).toEqual(["/p/open", "/p/recent"]);
});

it("deduplicates a root that is both open and recent", () => {
  const out = seedRoots(["/p/a", "/p/b"], ["/p/a"]);
  expect(out).toEqual(["/p/a", "/p/b"]);
});

it("drops blank and whitespace-only entries", () => {
  expect(seedRoots(["", "   "], [])).toEqual([]);
});

it("trims surrounding whitespace so a padded path is not a second project", () => {
  expect(seedRoots([" /p/a "], ["/p/a"])).toEqual(["/p/a"]);
});

it("returns an empty list for a brand new user with no history", () => {
  // A first-run user has no recents and no tabs. That is a normal state, not
  // an error: the registry is simply empty until they open something.
  expect(seedRoots([], [])).toEqual([]);
});
