import { expect, it } from "vitest";
import { formatElapsed } from "./atlasFormat";

it("shows plain seconds under a minute", () => {
  expect(formatElapsed(0)).toBe("0s");
  expect(formatElapsed(8)).toBe("8s");
  expect(formatElapsed(59)).toBe("59s");
});

it("switches to minutes at 60 seconds", () => {
  // "68s" made the reader do arithmetic to notice it was over a minute.
  expect(formatElapsed(60)).toBe("1m");
  expect(formatElapsed(68)).toBe("1m 8s");
  expect(formatElapsed(125)).toBe("2m 5s");
});

it("drops the seconds on a whole minute", () => {
  expect(formatElapsed(120)).toBe("2m");
});

it("handles long waits and junk input without breaking", () => {
  expect(formatElapsed(3661)).toBe("61m 1s");
  expect(formatElapsed(-5)).toBe("0s");
  expect(formatElapsed(8.7)).toBe("8s");
});
