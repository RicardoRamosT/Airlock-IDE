import { describe, expect, it } from "vitest";
import { extractLines, parseReferences } from "./references";

describe("parseReferences", () => {
  it("normalizes an array of Locations to uri+line+character", () => {
    expect(
      parseReferences([
        { uri: "file:///a.ts", range: { start: { line: 2, character: 4 } } },
        { uri: "file:///b.ts", range: { start: { line: 9, character: 0 } } },
      ]),
    ).toEqual([
      { uri: "file:///a.ts", line: 2, character: 4 },
      { uri: "file:///b.ts", line: 9, character: 0 },
    ]);
  });

  it("defaults a missing character to 0 and drops malformed entries", () => {
    expect(
      parseReferences([
        { uri: "file:///a.ts", range: { start: { line: 1 } } },
        { uri: "file:///b.ts" }, // no range -> dropped
        null, // dropped
        { range: { start: { line: 3 } } }, // no uri -> dropped
      ]),
    ).toEqual([{ uri: "file:///a.ts", line: 1, character: 0 }]);
  });

  it("returns [] for a non-array or null reply", () => {
    expect(parseReferences(null)).toEqual([]);
    expect(parseReferences({ uri: "x" })).toEqual([]);
  });
});

describe("extractLines", () => {
  it("returns trimmed text for the requested 0-indexed lines", () => {
    const content = "line0\n  line1  \nline2\nline3";
    expect(extractLines(content, [1, 3])).toEqual(
      new Map([
        [1, "line1"],
        [3, "line3"],
      ]),
    );
  });

  it("omits out-of-range lines and handles CRLF", () => {
    expect(extractLines("a\r\nb", [0, 5])).toEqual(new Map([[0, "a"]]));
  });

  it("maps line 0 of empty content to an empty string", () => {
    expect(extractLines("", [0])).toEqual(new Map([[0, ""]]));
  });
});
