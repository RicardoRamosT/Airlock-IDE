import { describe, expect, it } from "vitest";
import { levelAtLeast } from "./types";

describe("levelAtLeast", () => {
  it("is true when level meets or exceeds the minimum", () => {
    expect(levelAtLeast("error", "warn")).toBe(true);
    expect(levelAtLeast("warn", "warn")).toBe(true);
  });
  it("is false when level is below the minimum", () => {
    expect(levelAtLeast("debug", "info")).toBe(false);
  });
});
