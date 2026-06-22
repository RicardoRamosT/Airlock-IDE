import { describe, expect, it } from "vitest";
import { relativeTime, uncoveredAreaPaths } from "./overviewFreshness";

const NOW = 1_000_000_000_000;

describe("relativeTime", () => {
  it("says 'just now' under 45s (and for future timestamps)", () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe("just now");
    expect(relativeTime(NOW + 5_000, NOW)).toBe("just now");
  });
  it("buckets minutes, hours, days", () => {
    expect(relativeTime(NOW - 90_000, NOW)).toBe("1m ago");
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
    expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe("2d ago");
  });
});

describe("uncoveredAreaPaths", () => {
  it("flags area paths absent from the summary", () => {
    const summary = "## App\n- [x](../packages/app/src/main/index.ts)";
    expect(
      uncoveredAreaPaths(summary, ["packages/app", "packages/new-service"]),
    ).toEqual(["packages/new-service"]);
  });
  it("returns nothing when every area is mentioned", () => {
    expect(
      uncoveredAreaPaths("covers packages/app and docs", [
        "packages/app",
        "docs",
      ]),
    ).toEqual([]);
  });
});
