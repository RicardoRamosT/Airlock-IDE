import { describe, expect, it } from "vitest";
import { nextSlice, projectDots, type SpineCacheEntry } from "./spine";

const entry = (over: Partial<SpineCacheEntry> = {}): SpineCacheEntry => ({
  tree: { dirty: 0, branch: "main", hasRemote: true },
  ci: { status: "completed", conclusion: "success" },
  prs: [],
  ...over,
});

describe("projectDots", () => {
  it("emits one dot per watched root, in the order given", () => {
    const cache = new Map<string, SpineCacheEntry>([
      ["/p/alpha", entry()],
      [
        "/p/beta",
        entry({ ci: { status: "completed", conclusion: "failure" } }),
      ],
    ]);
    const got = projectDots(["/p/alpha", "/p/beta"], cache);
    expect(got.map((d) => d.root)).toEqual(["/p/alpha", "/p/beta"]);
    expect(got.map((d) => d.tone)).toEqual(["clean", "fail"]);
  });

  it("names the dot by the root's last segment", () => {
    const got = projectDots(["/p/alpha"], new Map([["/p/alpha", entry()]]));
    expect(got[0]?.name).toBe("alpha");
  });

  it("still emits a QUIET dot for a root nothing has been read for yet", () => {
    // Order is the feature: a project whose probes have not returned must keep
    // its slot, or every dot below it shifts when the first result lands.
    const got = projectDots(["/p/alpha", "/p/beta"], new Map());
    expect(got).toHaveLength(2);
    expect(got.map((d) => d.tone)).toEqual(["quiet", "quiet"]);
  });

  it("drops a cached root that is no longer watched", () => {
    const cache = new Map<string, SpineCacheEntry>([["/p/gone", entry()]]);
    expect(projectDots(["/p/alpha"], cache).map((d) => d.root)).toEqual([
      "/p/alpha",
    ]);
  });

  it("gives every dot a line that says why", () => {
    const got = projectDots(
      ["/p/alpha"],
      new Map([
        [
          "/p/alpha",
          entry({ ci: { status: "completed", conclusion: "failure" } }),
        ],
      ]),
    );
    expect(got[0]?.line).toContain("CI");
  });

  it("reports the uncommitted count on an otherwise quiet project", () => {
    const got = projectDots(
      ["/p/alpha"],
      new Map([
        [
          "/p/alpha",
          entry({ tree: { dirty: 1, branch: "main", hasRemote: true } }),
        ],
      ]),
    );
    expect(got[0]?.tone).toBe("quiet");
    expect(got[0]?.line).toBe("1 uncommitted change.");
  });

  it("emits nothing when no project is watched", () => {
    // The disabled path clears the cache and broadcasts this, which is what
    // makes the strip vanish and the workspace reclaim its column.
    expect(projectDots([], new Map())).toEqual([]);
  });
});

describe("nextSlice", () => {
  it("takes the next budget items and reports where to resume", () => {
    const items = ["a", "b", "c", "d", "e"];
    expect(nextSlice(items, 0, 2)).toEqual({ slice: ["a", "b"], next: 2 });
    expect(nextSlice(items, 2, 2)).toEqual({ slice: ["c", "d"], next: 4 });
  });

  it("wraps around the end", () => {
    expect(nextSlice(["a", "b", "c"], 2, 2)).toEqual({
      slice: ["c", "a"],
      next: 1,
    });
  });

  it("STARVES NOTHING: every item is reached within one pass", () => {
    // The failure this exists for is a slice that never reaches the tail --
    // the last projects in the debrief would sit permanently unread, showing
    // quiet dots that look exactly like "nothing to report".
    const items = ["a", "b", "c", "d", "e", "f", "g"];
    const seen = new Set<string>();
    let cursor = 0;
    for (let tick = 0; tick < Math.ceil(items.length / 2); tick += 1) {
      const r = nextSlice(items, cursor, 2);
      for (const x of r.slice) seen.add(x);
      cursor = r.next;
    }
    expect([...seen].sort()).toEqual(items);
  });

  it("returns the whole list once when the budget exceeds it", () => {
    expect(nextSlice(["a", "b"], 0, 9)).toEqual({
      slice: ["a", "b"],
      next: 0,
    });
  });

  it("asks for nothing when there is nothing, or no budget", () => {
    expect(nextSlice([], 3, 2)).toEqual({ slice: [], next: 0 });
    expect(nextSlice(["a"], 0, 0)).toEqual({ slice: [], next: 0 });
  });

  it("normalises a cursor left over from a longer list", () => {
    // The root list shrinks when a project is switched off, and the cursor
    // does not: an out-of-range start must not throw or skip the list.
    expect(nextSlice(["a", "b"], 7, 1)).toEqual({ slice: ["b"], next: 0 });
  });
});
