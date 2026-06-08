import { describe, expect, it } from "vitest";
import { firstDefinitionLocation } from "./definition";

describe("firstDefinitionLocation", () => {
  it("reads a single Location", () => {
    const r = {
      uri: "file:///a/b.ts",
      range: { start: { line: 4, character: 2 }, end: { line: 4, character: 9 } },
    };
    expect(firstDefinitionLocation(r)).toEqual({ uri: "file:///a/b.ts", line: 4 });
  });

  it("reads the first of a Location[]", () => {
    const r = [
      { uri: "file:///a/b.ts", range: { start: { line: 7, character: 0 }, end: { line: 7, character: 3 } } },
      { uri: "file:///a/c.ts", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } } },
    ];
    expect(firstDefinitionLocation(r)).toEqual({ uri: "file:///a/b.ts", line: 7 });
  });

  it("reads the first of a LocationLink[] preferring targetSelectionRange", () => {
    const r = [
      {
        targetUri: "file:///a/d.ts",
        targetSelectionRange: { start: { line: 11, character: 4 }, end: { line: 11, character: 8 } },
        targetRange: { start: { line: 10, character: 0 }, end: { line: 12, character: 1 } },
      },
    ];
    expect(firstDefinitionLocation(r)).toEqual({ uri: "file:///a/d.ts", line: 11 });
  });

  it("falls back to targetRange when targetSelectionRange is absent", () => {
    const r = [
      { targetUri: "file:///a/e.ts", targetRange: { start: { line: 3, character: 0 }, end: { line: 3, character: 5 } } },
    ];
    expect(firstDefinitionLocation(r)).toEqual({ uri: "file:///a/e.ts", line: 3 });
  });

  it("returns null for null, empty array, and unrecognized shapes", () => {
    expect(firstDefinitionLocation(null)).toBeNull();
    expect(firstDefinitionLocation([])).toBeNull();
    expect(firstDefinitionLocation({ foo: 1 })).toBeNull();
    expect(firstDefinitionLocation({ uri: "file:///x.ts" })).toBeNull(); // no range
  });
});
