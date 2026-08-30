import type { CollectDeps } from "@airlock/agent-core";
import { expect, it } from "vitest";
import { type RefreshInput, refreshPortfolio } from "./refresh";
import { openAtlasDb, readRegistry, readSnapshot } from "./store";

const deps = (over: Partial<CollectDeps> = {}): CollectDeps => ({
  exists: async () => true,
  isRepo: async () => true,
  status: async () => ({
    branch: { head: "main", upstream: "origin/main", ahead: 0, behind: 0 },
    staged: [],
    unstaged: [],
    untracked: [],
  }),
  log: async () => [],
  ...over,
});

const input = (over: Partial<RefreshInput> = {}): RefreshInput => ({
  db: openAtlasDb(":memory:"),
  deps: deps(),
  recentFolders: ["/p/a"],
  openTabRoots: ["/p/b"],
  now: Date.UTC(2026, 7, 30, 18, 0, 0),
  tzOffsetMinutes: -360,
  sinceMs: 0,
  ...over,
});

it("seeds the registry from recents and tabs on a first run", async () => {
  const i = input();
  await refreshPortfolio(i);
  expect(
    readRegistry(i.db)
      .map((p) => p.root)
      .sort(),
  ).toEqual(["/p/a", "/p/b"]);
});

it("keeps a root that has since fallen out of recents", async () => {
  // recentFolders is capped at 10; the registry is what makes a root durable.
  const i = input();
  await refreshPortfolio(i);
  await refreshPortfolio({ ...i, recentFolders: [], openTabRoots: [] });
  expect(
    readRegistry(i.db)
      .map((p) => p.root)
      .sort(),
  ).toEqual(["/p/a", "/p/b"]);
});

it("marks a vanished root missing but keeps it in the registry", async () => {
  const i = input();
  await refreshPortfolio(i);
  await refreshPortfolio({
    ...i,
    deps: deps({ exists: async (r) => r !== "/p/a" }),
  });
  const reg = readRegistry(i.db);
  expect(reg).toHaveLength(2);
  expect(reg.find((p) => p.root === "/p/a")?.missing).toBe(true);
});

it("writes the snapshot under the user's LOCAL day key", async () => {
  // 18:00 UTC on Aug 30 is still Aug 30 at UTC-6.
  const i = input();
  await refreshPortfolio(i);
  expect(readSnapshot(i.db, "2026-08-30")).toHaveLength(2);
  expect(readSnapshot(i.db, "2026-08-31")).toBeNull();
});

it("returns an empty snapshot for a first-run user with no history", async () => {
  const i = input({ recentFolders: [], openTabRoots: [] });
  const out = await refreshPortfolio(i);
  expect(out).toEqual([]);
  expect(readSnapshot(i.db, "2026-08-30")).toEqual([]);
});
