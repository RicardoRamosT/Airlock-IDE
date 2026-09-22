import { describe, expect, it } from "vitest";
import { projectDots, type SpineCacheEntry } from "./spine";

const entry = (over: Partial<SpineCacheEntry> = {}): SpineCacheEntry => ({
  tree: { dirty: 0, branch: "main", hasRemote: true },
  ci: { status: "completed", conclusion: "success" },
  prs: [],
  ...over,
});

describe("projectDots", () => {
  it("emits one dot per open root, in the order given", () => {
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

  it("drops a cached root that is no longer open", () => {
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

  it("emits nothing when no project is open", () => {
    // The disabled path clears the cache and broadcasts this, which is what
    // makes the strip vanish and the workspace reclaim its column.
    expect(projectDots([], new Map())).toEqual([]);
  });
});
