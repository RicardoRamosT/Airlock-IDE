import { describe, expect, it } from "vitest";
import {
  dropAction,
  hoverTarget,
  resolveDropTarget,
  sameTarget,
  type WindowBox,
} from "./target";

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

describe("dropAction", () => {
  const ctx = (o: Partial<Parameters<typeof dropAction>[1]> = {}) => ({
    hasPayload: true,
    canAdopt: true,
    canDetach: true,
    ...o,
  });

  it("moves nothing when the renderer sent no payload", () => {
    expect(dropAction({ kind: "detach" }, ctx({ hasPayload: false }))).toBe(
      "none",
    );
  });

  it("moves nothing on an in-window reorder", () => {
    expect(dropAction({ kind: "reorder" }, ctx())).toBe("none");
  });

  it("merges a window's LAST tab -- that is how a torn-off window is put back", () => {
    // The tab cannot DETACH (its window is already this project's own window),
    // but dropping it onto another window is a real move. Conflating the two is
    // what made a torn-off window impossible to re-merge: the drop reported a
    // merge target and then moved nothing.
    expect(
      dropAction({ kind: "merge", windowId: 2 }, ctx({ canDetach: false })),
    ).toBe("merge");
  });

  it("never detaches a window's last tab", () => {
    expect(dropAction({ kind: "detach" }, ctx({ canDetach: false }))).toBe(
      "none",
    );
  });

  it("falls back to a new window when the merge target cannot adopt", () => {
    // Target closed between the last hover and the release: detach rather than
    // hand the tab to a renderer that ignores it while the source lets it go.
    expect(
      dropAction({ kind: "merge", windowId: 2 }, ctx({ canAdopt: false })),
    ).toBe("detach");
  });

  it("keeps a last tab put when its merge target cannot adopt", () => {
    expect(
      dropAction(
        { kind: "merge", windowId: 2 },
        ctx({ canAdopt: false, canDetach: false }),
      ),
    ).toBe("none");
  });
});

describe("hoverTarget", () => {
  it("never offers a new window to a tab that cannot detach", () => {
    // The hint must promise only what the release will actually do. A window's
    // last tab cannot open ANOTHER window, so "Release to open B in a new
    // window" would be the same lie the unmergeable torn-off tab told.
    expect(hoverTarget({ kind: "detach" }, false)).toEqual({ kind: "reorder" });
  });

  it("still offers the merge, which a last tab CAN do", () => {
    expect(hoverTarget({ kind: "merge", windowId: 2 }, false)).toEqual({
      kind: "merge",
      windowId: 2,
    });
  });

  it("leaves every target alone when the tab can detach", () => {
    expect(hoverTarget({ kind: "detach" }, true)).toEqual({ kind: "detach" });
    expect(hoverTarget({ kind: "reorder" }, true)).toEqual({ kind: "reorder" });
  });
});
