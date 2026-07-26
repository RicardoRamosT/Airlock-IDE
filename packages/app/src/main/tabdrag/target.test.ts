import { describe, expect, it } from "vitest";
import { resolveDropTarget, sameTarget, type WindowBox } from "./target";

const box = (id: number, x: number, y: number): WindowBox => ({
  id,
  bounds: { x, y, width: 100, height: 100 },
});

describe("resolveDropTarget", () => {
  const wins = [box(1, 0, 0), box(2, 200, 0)];

  it("reorders when released inside the source window", () => {
    expect(resolveDropTarget({ x: 50, y: 50 }, wins, 1)).toEqual({
      kind: "reorder",
    });
  });

  it("merges when released over another window", () => {
    expect(resolveDropTarget({ x: 250, y: 50 }, wins, 1)).toEqual({
      kind: "merge",
      windowId: 2,
    });
  });

  it("detaches when released outside every window", () => {
    expect(resolveDropTarget({ x: 999, y: 999 }, wins, 1)).toEqual({
      kind: "detach",
    });
  });

  it("picks the FRONT-MOST window when two overlap (caller passes MRU order)", () => {
    const overlapping = [box(3, 0, 0), box(1, 0, 0)]; // 3 is front-most
    expect(resolveDropTarget({ x: 10, y: 10 }, overlapping, 1)).toEqual({
      kind: "merge",
      windowId: 3,
    });
  });

  it("reorders (never moves a tab) when the cursor point is unknown", () => {
    expect(resolveDropTarget(null, wins, 1)).toEqual({ kind: "reorder" });
  });

  it("detaches when the source window is gone from the list", () => {
    expect(resolveDropTarget({ x: 999, y: 999 }, [], 1)).toEqual({
      kind: "detach",
    });
  });

  it("treats bounds as half-open so touching edges do not double-match", () => {
    // x=100 is one past the right edge of a window at x=0 width=100.
    expect(resolveDropTarget({ x: 100, y: 50 }, [box(1, 0, 0)], 9)).toEqual({
      kind: "detach",
    });
    expect(resolveDropTarget({ x: 99, y: 99 }, [box(1, 0, 0)], 9)).toEqual({
      kind: "merge",
      windowId: 1,
    });
  });
});

describe("sameTarget", () => {
  it("compares kind and windowId so hover can be edge-triggered", () => {
    expect(sameTarget({ kind: "reorder" }, { kind: "reorder" })).toBe(true);
    expect(sameTarget({ kind: "detach" }, { kind: "reorder" })).toBe(false);
    expect(
      sameTarget(
        { kind: "merge", windowId: 1 },
        { kind: "merge", windowId: 1 },
      ),
    ).toBe(true);
    expect(
      sameTarget(
        { kind: "merge", windowId: 1 },
        { kind: "merge", windowId: 2 },
      ),
    ).toBe(false);
  });
});
