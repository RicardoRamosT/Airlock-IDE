import { describe, expect, it } from "vitest";
import type { DirEntry } from "../../../shared/ipc";
import { applyOrder, dropZone, reorderNames } from "./fileOrder";

const E = (...names: string[]): DirEntry[] =>
  names.map((name) => ({ name, type: "file" }));

describe("applyOrder", () => {
  it("returns entries unchanged when there is no saved order", () => {
    const entries = E("a", "b");
    expect(applyOrder(entries, undefined)).toBe(entries);
    expect(applyOrder(entries, [])).toBe(entries);
  });
  it("respects the saved order", () => {
    expect(
      applyOrder(E("a", "b", "c"), ["c", "a", "b"]).map((e) => e.name),
    ).toEqual(["c", "a", "b"]);
  });
  it("appends new (unlisted) entries after, in incoming order", () => {
    expect(
      applyOrder(E("a", "b", "new"), ["b", "a"]).map((e) => e.name),
    ).toEqual(["b", "a", "new"]);
  });
  it("drops saved names with no matching entry", () => {
    expect(applyOrder(E("a"), ["gone", "a"]).map((e) => e.name)).toEqual(["a"]);
  });
});

describe("dropZone", () => {
  const rect = { top: 0, height: 20 };
  it("splits a file row at the midpoint", () => {
    expect(dropZone(rect, 5, false)).toBe("before");
    expect(dropZone(rect, 15, false)).toBe("after");
  });
  it("gives a dir row before/into/after bands", () => {
    expect(dropZone(rect, 2, true)).toBe("before");
    expect(dropZone(rect, 10, true)).toBe("into");
    expect(dropZone(rect, 18, true)).toBe("after");
  });
});

describe("reorderNames", () => {
  it("moves dragged after the target", () => {
    expect(reorderNames(["a", "b", "c"], "a", "b", "after")).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
  it("moves dragged before the target", () => {
    expect(reorderNames(["a", "b", "c"], "c", "a", "before")).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
  it("is a no-op when dragged equals target", () => {
    const names = ["a", "b"];
    expect(reorderNames(names, "a", "a", "after")).toBe(names);
  });
  it("returns the input unchanged when the target is absent", () => {
    const names = ["a", "b"];
    expect(reorderNames(names, "a", "zzz", "after")).toBe(names);
  });
});
