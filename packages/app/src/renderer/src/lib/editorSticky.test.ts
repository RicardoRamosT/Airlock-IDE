import { describe, expect, it } from "vitest";
import type { Scope } from "./editorScopes";
import { stickyLines } from "./editorSticky";

const s = (name: string, line: number, endLine: number): Scope => ({
  name,
  kind: "x",
  line,
  endLine,
  from: 0,
  to: 0,
});
const scopes = [s("A", 1, 100), s("b", 5, 40), s("c", 10, 20), s("d", 12, 18)];

describe("stickyLines", () => {
  it("pins enclosing scopes whose head is above the top visible line", () => {
    // viewport top at line 15: inside A,b,c,d; all heads (1,5,10,12) are above 15
    expect(stickyLines(scopes, 15).map((x) => x.name)).toEqual([
      "A",
      "b",
      "c",
      "d",
    ]);
  });
  it("excludes a scope whose head IS the top line (not yet scrolled past)", () => {
    expect(stickyLines(scopes, 10).map((x) => x.name)).toEqual(["A", "b"]);
  });
  it("caps at max (default 5), keeping the innermost", () => {
    const deep = [
      s("A", 1, 100),
      s("B", 2, 99),
      s("C", 3, 98),
      s("D", 4, 97),
      s("E", 5, 96),
      s("F", 6, 95),
    ];
    expect(stickyLines(deep, 50).map((x) => x.name)).toEqual([
      "B",
      "C",
      "D",
      "E",
      "F",
    ]);
  });
});
