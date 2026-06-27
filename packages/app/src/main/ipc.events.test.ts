import { describe, expect, it } from "vitest";
import { sanitizeEventFilter } from "./ipc";

describe("sanitizeEventFilter", () => {
  it("keeps valid fields and coerces limit to a positive int", () => {
    expect(
      sanitizeEventFilter({
        level: "warn",
        category: "db",
        op: "db.",
        limit: 12.7,
      }),
    ).toEqual({ level: "warn", category: "db", op: "db.", limit: 12 });
  });
  it("drops unknown/invalid fields and a bad level", () => {
    expect(sanitizeEventFilter({ level: "bogus", evil: 1, limit: -5 })).toEqual(
      {},
    );
  });
  it("returns {} for non-object input", () => {
    expect(sanitizeEventFilter("nope")).toEqual({});
  });
});
