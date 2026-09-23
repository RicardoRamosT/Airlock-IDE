import { expect, it } from "vitest";
import {
  type AtlasProject,
  applyPresence,
  applyPresenceResults,
  mergeRegistry,
  projectName,
} from "./registry";

const P = (root: string, over: Partial<AtlasProject> = {}): AtlasProject => ({
  root,
  name: projectName(root),
  addedAt: 1000,
  lastSeenAt: 1000,
  missing: false,
  enabled: false,
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

it("does NOT restamp lastSeenAt just for being rediscovered", () => {
  // Being in recents or an open tab is not evidence the folder still exists --
  // a recents entry outlives the directory it names, which is exactly what
  // `missing` reports. If merge stamped it, "last seen" would read as now for
  // a folder deleted weeks ago, which is the one moment the field matters.
  // Only the presence pass writes it.
  const out = mergeRegistry([P("/a/one")], ["/a/one"], 9000);
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ addedAt: 1000, lastSeenAt: 1000 });
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

it("defaults a newly discovered project to OFF", () => {
  // Opt-in: a project Atlas has just noticed is not in the debrief until the
  // user says so.
  const [p] = mergeRegistry([], ["/p/new"], 100);
  expect(p?.enabled).toBe(false);
});

it("preserves enabled when a known project is re-discovered", () => {
  // THE test for this feature. refreshPortfolio runs read -> mergeRegistry ->
  // applyPresence -> writeRegistry on every window focus, resume, unlock and a
  // 15-minute timer. If merge drops `enabled`, the switch works in the UI,
  // persists, and is erased seconds later -- with every other test green.
  const on = mergeRegistry([], ["/p/a"], 100).map((p) => ({
    ...p,
    enabled: true,
  }));
  const again = mergeRegistry(on, ["/p/a"], 200);
  expect(again[0]?.enabled).toBe(true);
  // addedAt is what a re-discovery must preserve. lastSeenAt is the presence
  // pass's to write, not merge's -- see the restamp test above.
  expect(again[0]?.addedAt).toBe(100);
});

it("leaves enabled alone when presence is applied", () => {
  const on = mergeRegistry([], ["/p/a"], 100).map((p) => ({
    ...p,
    enabled: true,
  }));
  const after = applyPresence(on, new Set<string>(), 200);
  expect(after[0]?.missing).toBe(true);
  expect(after[0]?.enabled).toBe(true);
});

// --- presence is THREE states, not two ----------------------------------

it("flags a root only when it is KNOWN gone, never when it could not be checked", () => {
  // The bug this exists for: presence came from one `fs.access` with a bare
  // catch, so ENOENT and EPERM produced the same answer. A live project on an
  // unmounted drive, or behind a macOS permission prompt, read as gone -- and
  // a gone project is dropped from the debrief, the spine and the local-app
  // monitor, silently. "Could not check" is not "is not there".
  const out = applyPresenceResults(
    [P("/a/here"), P("/a/gone"), P("/a/unreachable")],
    new Map([
      ["/a/here", "present" as const],
      ["/a/gone", "gone" as const],
      ["/a/unreachable", "unknown" as const],
    ]),
    7000,
  );
  expect(out.find((p) => p.root === "/a/here")).toMatchObject({
    missing: false,
    lastSeenAt: 7000,
  });
  expect(out.find((p) => p.root === "/a/gone")).toMatchObject({
    missing: true,
    lastSeenAt: 1000,
  });
  // Untouched: neither the flag nor the timestamp may move on a failed read.
  expect(out.find((p) => p.root === "/a/unreachable")).toMatchObject({
    missing: false,
    lastSeenAt: 1000,
  });
});

it("leaves an ALREADY-missing root alone when the check fails", () => {
  // The other direction of the same rule: an unread probe must not clear a
  // flag either. Only evidence moves it.
  const out = applyPresenceResults(
    [P("/a/gone", { missing: true })],
    new Map([["/a/gone", "unknown" as const]]),
    7000,
  );
  expect(out[0]).toMatchObject({ missing: true, lastSeenAt: 1000 });
});

it("leaves a root the probe said nothing about entirely alone", () => {
  const out = applyPresenceResults([P("/a/here")], new Map(), 7000);
  expect(out[0]).toMatchObject({ missing: false, lastSeenAt: 1000 });
});
