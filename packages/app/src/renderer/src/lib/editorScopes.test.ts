import { describe, expect, it } from "vitest";
import { enclosingScopes, pathSegments, type Scope } from "./editorScopes";

const scopes: Scope[] = [
  { name: "Outer", kind: "class", line: 1, endLine: 20, from: 0, to: 200 },
  { name: "inner", kind: "method", line: 3, endLine: 12, from: 20, to: 120 },
  {
    name: "sibling",
    kind: "method",
    line: 15,
    endLine: 19,
    from: 130,
    to: 190,
  },
];

describe("enclosingScopes", () => {
  it("returns the outer->inner chain containing a line", () => {
    // line 5 is inside Outer (1-20) and inner (3-12) but not sibling (15-19)
    const chain = enclosingScopes(scopes, 5).map((s) => s.name);
    expect(chain).toEqual(["Outer", "inner"]);
  });
  it("orders by nesting (outer first) regardless of input order", () => {
    // line 16 is inside Outer (1-20) and sibling (15-19) but not inner (3-12)
    const chain = enclosingScopes(scopes, 16).map((s) => s.name);
    expect(chain).toEqual(["Outer", "sibling"]);
  });
  it("returns [] when no scope contains the line", () => {
    expect(enclosingScopes(scopes, 999)).toEqual([]);
  });
  it("orders outer-first even when the input array is not pre-sorted", () => {
    // Deliberately NOT in ascending `line` order -- proves .sort() actually
    // runs (Array.filter alone would just preserve this input order).
    const shuffled: Scope[] = [
      {
        name: "ChildA",
        kind: "method",
        line: 3,
        endLine: 12,
        from: 20,
        to: 120,
      },
      {
        name: "ChildB",
        kind: "method",
        line: 15,
        endLine: 19,
        from: 130,
        to: 190,
      },
      { name: "Root", kind: "class", line: 1, endLine: 20, from: 0, to: 200 },
    ];
    // line 5 is inside Root (1-20) and ChildA (3-12) but not ChildB (15-19).
    // Filter-preserved (unsorted) order would be ["ChildA", "Root"].
    const chain = enclosingScopes(shuffled, 5).map((s) => s.name);
    expect(chain).toEqual(["Root", "ChildA"]);
  });
  it("breaks ties by wider endLine first when scopes share the same head line", () => {
    const tied: Scope[] = [
      { name: "narrow", kind: "method", line: 5, endLine: 10, from: 0, to: 10 },
      { name: "wide", kind: "class", line: 5, endLine: 40, from: 0, to: 40 },
    ];
    // Both contain line 7 and share `line: 5`; only the b.endLine - a.endLine
    // tie-break puts "wide" first -- a stable sort without it would keep the
    // narrow-first input order.
    const chain = enclosingScopes(tied, 7).map((s) => s.name);
    expect(chain).toEqual(["wide", "narrow"]);
  });
});

describe("pathSegments", () => {
  it("splits a relative path into segments", () => {
    expect(pathSegments("src/lib/foo.ts")).toEqual(["src", "lib", "foo.ts"]);
  });
  it("handles a bare filename", () => {
    expect(pathSegments("README.md")).toEqual(["README.md"]);
  });
  it("drops empty segments from leading/duplicate slashes", () => {
    expect(pathSegments("/a//b.ts")).toEqual(["a", "b.ts"]);
  });
});
