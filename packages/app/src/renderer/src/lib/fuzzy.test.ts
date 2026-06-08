import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyScore } from "./fuzzy";

describe("fuzzyScore", () => {
  it("returns null when query is not a subsequence", () => {
    expect(fuzzyScore("xyz", "abc")).toBeNull();
  });
  it("empty query matches with score 0 and no indices", () => {
    expect(fuzzyScore("", "abc")).toEqual({ score: 0, indices: [] });
  });
  it("records matched indices, case-insensitively", () => {
    expect(fuzzyScore("ab", "AxBy")?.indices).toEqual([0, 2]);
  });
  it("scores consecutive higher than scattered", () => {
    const consec = fuzzyScore("ab", "abxx");
    const scattered = fuzzyScore("ab", "axbx");
    expect(consec && scattered && consec.score > scattered.score).toBe(true);
  });
  it("rewards word-boundary matches (separator + camelCase)", () => {
    const boundary = fuzzyScore("ft", "file_tree");
    const mid = fuzzyScore("ft", "soft");
    expect(boundary && mid && boundary.score > mid.score).toBe(true);
    expect(fuzzyScore("ft", "fileTree")?.indices).toEqual([0, 4]);
  });
});

describe("fuzzyFilter", () => {
  it("keeps matches, drops non-matches, sorts best first", () => {
    const out = fuzzyFilter("ft", ["soft", "file_tree", "zzz"], (s) => s);
    expect(out.map((o) => o.item)).toEqual(["file_tree", "soft"]);
  });
  it("empty query keeps all in original order", () => {
    const out = fuzzyFilter("", ["b", "a"], (s) => s);
    expect(out.map((o) => o.item)).toEqual(["b", "a"]);
  });
});
