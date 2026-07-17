import { describe, expect, it } from "vitest";
import { normalizeDocumentSymbols } from "./lspSymbols";

describe("normalizeDocumentSymbols", () => {
  it("normalizes hierarchical DocumentSymbol[] to 1-based lines with children", () => {
    const raw = [
      {
        name: "Foo",
        kind: 5,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 9, character: 1 },
        },
        children: [
          {
            name: "bar",
            kind: 6,
            range: {
              start: { line: 2, character: 2 },
              end: { line: 4, character: 3 },
            },
          },
        ],
      },
    ];
    const out = normalizeDocumentSymbols(raw);
    expect(out).toEqual([
      {
        name: "Foo",
        kind: 5,
        range: { startLine: 1, startChar: 0, endLine: 10, endChar: 1 },
        children: [
          {
            name: "bar",
            kind: 6,
            range: { startLine: 3, startChar: 2, endLine: 5, endChar: 3 },
            children: [],
          },
        ],
      },
    ]);
  });

  it("normalizes flat SymbolInformation[] (location.range, no children)", () => {
    const raw = [
      {
        name: "top",
        kind: 12,
        location: {
          uri: "file:///x.ts",
          range: {
            start: { line: 5, character: 0 },
            end: { line: 5, character: 8 },
          },
        },
      },
    ];
    expect(normalizeDocumentSymbols(raw)).toEqual([
      {
        name: "top",
        kind: 12,
        range: { startLine: 6, startChar: 0, endLine: 6, endChar: 8 },
        children: [],
      },
    ]);
  });

  it("returns [] for null / non-array", () => {
    expect(normalizeDocumentSymbols(null)).toEqual([]);
    expect(normalizeDocumentSymbols({})).toEqual([]);
  });
});
