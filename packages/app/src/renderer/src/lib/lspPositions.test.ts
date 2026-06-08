import { describe, expect, it } from "vitest";
import { positionAt } from "./lspPositions";

describe("positionAt", () => {
  const text = "ab\ncde\nf";
  it("maps offsets to line/character", () => {
    expect(positionAt(text, 0)).toEqual({ line: 0, character: 0 });
    expect(positionAt(text, 2)).toEqual({ line: 0, character: 2 });
    expect(positionAt(text, 3)).toEqual({ line: 1, character: 0 });
    expect(positionAt(text, 5)).toEqual({ line: 1, character: 2 });
  });
  it("clamps out-of-range offsets", () => {
    expect(positionAt(text, 999)).toEqual({ line: 2, character: 1 });
    expect(positionAt(text, -5)).toEqual({ line: 0, character: 0 });
  });
});
