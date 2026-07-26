import { describe, expect, it } from "vitest";
import type { SessionSnapshot } from "../../shared/ipc";
import { mergeSnapshots } from "./merge";

const snap = (
  roots: string[],
  activeRoot: string | null = null,
  split: SessionSnapshot["split"] = null,
): SessionSnapshot => ({
  version: 1,
  tabs: roots.map((root) => ({ root, hadClaude: false })),
  activeRoot,
  split,
});

describe("mergeSnapshots", () => {
  it("unions both windows' tabs, so tearing a tab off cannot lose the rest", () => {
    // The exact regression: window 2 (one torn-off project) used to overwrite
    // window 1's whole tab list.
    const merged = mergeSnapshots(
      [
        { id: 1, snap: snap(["/a", "/b", "/c"], "/a") },
        { id: 2, snap: snap(["/d"], "/d") },
      ],
      1,
    );
    expect(merged?.tabs.map((t) => t.root)).toEqual(["/a", "/b", "/c", "/d"]);
  });

  it("puts the FOCUSED window's tabs first and takes its activeRoot", () => {
    const merged = mergeSnapshots(
      [
        { id: 1, snap: snap(["/a"], "/a") },
        { id: 2, snap: snap(["/d", "/e"], "/e") },
      ],
      2,
    );
    expect(merged?.tabs.map((t) => t.root)).toEqual(["/d", "/e", "/a"]);
    expect(merged?.activeRoot).toBe("/e");
  });

  it("dedupes a project open in two windows", () => {
    const merged = mergeSnapshots(
      [
        { id: 1, snap: snap(["/a", "/shared"]) },
        { id: 2, snap: snap(["/shared", "/b"]) },
      ],
      1,
    );
    expect(merged?.tabs.map((t) => t.root)).toEqual(["/a", "/shared", "/b"]);
  });

  it("keeps a split only when both members survive", () => {
    const ok = mergeSnapshots(
      [{ id: 1, snap: snap(["/a", "/b"], "/a", { a: "/a", b: "/b" }) }],
      1,
    );
    expect(ok?.split).toEqual({ a: "/a", b: "/b" });
    // A split naming a root that is not in the tabs cannot be rebuilt -> dropped.
    const bad = mergeSnapshots(
      [{ id: 1, snap: snap(["/a"], "/a", { a: "/a", b: "/gone" }) }],
      1,
    );
    expect(bad?.split).toBeNull();
  });

  it("preserves each tab's hadClaude flag", () => {
    const withClaude: SessionSnapshot = {
      version: 1,
      tabs: [{ root: "/a", hadClaude: true }],
      activeRoot: "/a",
      split: null,
    };
    const merged = mergeSnapshots([{ id: 1, snap: withClaude }], 1);
    expect(merged?.tabs[0]?.hadClaude).toBe(true);
  });

  it("returns null with nothing to merge, and copes with an unknown focus", () => {
    expect(mergeSnapshots([], 1)).toBeNull();
    const merged = mergeSnapshots([{ id: 7, snap: snap(["/a"], "/a") }], null);
    expect(merged?.tabs.map((t) => t.root)).toEqual(["/a"]);
  });
});
