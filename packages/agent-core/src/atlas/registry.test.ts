import { expect, it } from "vitest";
import {
  type AtlasProject,
  applyPresence,
  mergeRegistry,
  projectName,
} from "./registry";

const P = (root: string, over: Partial<AtlasProject> = {}): AtlasProject => ({
  root,
  name: projectName(root),
  addedAt: 1000,
  lastSeenAt: 1000,
  missing: false,
  ...over,
});

it("derives a display name from the last path segment", () => {
  expect(projectName("/Users/x/Projects/airlock")).toBe("airlock");
  expect(projectName("/Users/x/Projects/Keyview Track")).toBe("Keyview Track");
  expect(projectName("/Users/x/Projects/airlock/")).toBe("airlock");
});

it("adds discovered roots that are not yet known", () => {
  const out = mergeRegistry([], ["/a/one", "/a/two"], 5000);
  expect(out.map((p) => p.root)).toEqual(["/a/one", "/a/two"]);
  expect(out[0]).toMatchObject({
    name: "one",
    addedAt: 5000,
    lastSeenAt: 5000,
  });
});

it("NEVER evicts a known root that is absent from the discovered list", () => {
  // This is the whole point of a registry: recentFolders is capped at 10, so a
  // root falling out of it must not fall out of Atlas.
  const out = mergeRegistry([P("/a/old")], ["/a/new"], 5000);
  expect(out.map((p) => p.root).sort()).toEqual(["/a/new", "/a/old"]);
});

it("refreshes lastSeenAt for a rediscovered root without changing addedAt", () => {
  const out = mergeRegistry([P("/a/one")], ["/a/one"], 9000);
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ addedAt: 1000, lastSeenAt: 9000 });
});

it("ignores duplicates and blank roots in the discovered list", () => {
  const out = mergeRegistry([], ["/a/one", "/a/one", "", "  "], 5000);
  expect(out.map((p) => p.root)).toEqual(["/a/one"]);
});

it("marks a root missing when it is not present, without dropping it", () => {
  const out = applyPresence(
    [P("/a/gone"), P("/a/here")],
    new Set(["/a/here"]),
    7000,
  );
  expect(out.find((p) => p.root === "/a/gone")).toMatchObject({
    missing: true,
  });
  expect(out.find((p) => p.root === "/a/here")).toMatchObject({
    missing: false,
    lastSeenAt: 7000,
  });
});

it("clears missing when a root comes back, and leaves lastSeenAt of absent roots alone", () => {
  const out = applyPresence(
    [P("/a/back", { missing: true })],
    new Set(["/a/back"]),
    7000,
  );
  expect(out[0]).toMatchObject({ missing: false, lastSeenAt: 7000 });
  const still = applyPresence([P("/a/gone")], new Set(), 7000);
  expect(still[0]).toMatchObject({ missing: true, lastSeenAt: 1000 });
});
