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
