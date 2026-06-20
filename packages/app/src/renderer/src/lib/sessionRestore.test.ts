import { describe, expect, it } from "vitest";
import type { SessionSnapshot } from "../../../shared/ipc";
import { planRestore } from "./sessionRestore";

const snap: SessionSnapshot = {
  version: 1,
  tabs: [
    { root: "/a", hadClaude: true },
    { root: "/gone", hadClaude: true }, // missing on disk -> skipped
    { root: "/b", hadClaude: false },
  ],
  activeRoot: "/b",
  split: { a: "/a", b: "/b" },
};

describe("planRestore", () => {
  it("skips missing roots, keeps order, marks hadClaude roots for resume", () => {
    const plan = planRestore(snap, (root) => root !== "/gone");
    expect(plan.roots).toEqual(["/a", "/b"]); // /gone dropped, order kept
    expect(plan.resumeRoots).toEqual(["/a"]); // only existing hadClaude
    expect(plan.activeRoot).toBe("/b");
    expect(plan.split).toEqual({ a: "/a", b: "/b" }); // both exist
  });

  it("drops the split if either member is missing", () => {
    const plan = planRestore(
      { ...snap, split: { a: "/a", b: "/gone" } },
      (root) => root !== "/gone",
    );
    expect(plan.split).toBeNull();
  });

  it("falls back active to the first restored root when activeRoot is gone", () => {
    const plan = planRestore(
      { ...snap, activeRoot: "/gone" },
      (root) => root !== "/gone",
    );
    expect(plan.activeRoot).toBe("/a");
  });

  it("empty/blank snapshot yields an empty plan", () => {
    const plan = planRestore(
      { version: 1, tabs: [], activeRoot: null, split: null },
      () => true,
    );
    expect(plan.roots).toEqual([]);
  });
});
