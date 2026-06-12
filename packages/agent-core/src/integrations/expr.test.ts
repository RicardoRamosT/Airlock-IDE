import { describe, expect, it } from "vitest";
import { evalExpr } from "./expr";

describe("evalExpr", () => {
  it("reads nested fields", () => {
    expect(evalExpr({ a: { b: 5 } }, "$.a.b")).toBe(5);
  });
  it("indexes arrays", () => {
    expect(evalExpr({ a: [{ b: 1 }, { b: 2 }] }, "$.a[1].b")).toBe(2);
  });
  it("supports .length on arrays and strings", () => {
    expect(evalExpr({ a: [1, 2, 3] }, "$.a.length")).toBe(3);
    expect(evalExpr({ s: "abcd" }, "$.s.length")).toBe(4);
  });
  it("returns the whole doc for $", () => {
    expect(evalExpr({ a: 1 }, "$")).toEqual({ a: 1 });
  });
  it("returns undefined for a missing path, never throws", () => {
    expect(evalExpr({}, "$.x.y")).toBeUndefined();
    expect(evalExpr(null, "$.x")).toBeUndefined();
  });
});
