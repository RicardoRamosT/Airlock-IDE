import type { CollectDeps } from "@airlock/agent-core";
import { expect, it } from "vitest";
import { directDb } from "./dbOps";
import { type RefreshInput, refreshPortfolio } from "./refresh";
import { openAtlasDb } from "./store";

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
  db: directDb(openAtlasDb(":memory:")),
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
  expect((await i.db.readRegistry()).map((p) => p.root).sort()).toEqual([
    "/p/a",
    "/p/b",
  ]);
});

it("keeps a root that has since fallen out of recents", async () => {
  // recentFolders is capped at 10; the registry is what makes a root durable.
  const i = input();
  await refreshPortfolio(i);
  await refreshPortfolio({ ...i, recentFolders: [], openTabRoots: [] });
  expect((await i.db.readRegistry()).map((p) => p.root).sort()).toEqual([
    "/p/a",
    "/p/b",
  ]);
});

it("marks a vanished root missing but keeps it in the registry", async () => {
  const i = input();
  await refreshPortfolio(i);
  await refreshPortfolio({
    ...i,
    deps: deps({ exists: async (r) => r !== "/p/a" }),
  });
  const reg = await i.db.readRegistry();
  expect(reg).toHaveLength(2);
  expect(reg.find((p) => p.root === "/p/a")?.missing).toBe(true);
});

it("writes the snapshot under the user's LOCAL day key", async () => {
  // 18:00 UTC on Aug 30 is still Aug 30 at UTC-6.
  const i = input();
  await refreshPortfolio(i);
  expect(await i.db.readSnapshot("2026-08-30")).toHaveLength(2);
  expect(await i.db.readSnapshot("2026-08-31")).toBeNull();
});

it("returns an empty snapshot for a first-run user with no history", async () => {
  const i = input({ recentFolders: [], openTabRoots: [] });
  const out = await refreshPortfolio(i);
  expect(out).toEqual([]);
  expect(await i.db.readSnapshot("2026-08-30")).toEqual([]);
});

it("accumulates a concern's history across refreshes", async () => {
  // The end-to-end proof of the feature: run twice with the number growing and
  // the stored concern must remember where it started. This is what turns
  // "airlock has no remote" -- said identically for six days -- into
  // "6 days, 28 -> 44".
  const noRemote = (ahead: number) =>
    deps({
      status: async () => ({
        branch: { head: "main", upstream: null, ahead, behind: 0 },
        staged: [],
        unstaged: [],
        untracked: [],
      }),
    });
  const i = input({ recentFolders: ["/p/airlock"], openTabRoots: [] });

  await refreshPortfolio({ ...i, deps: noRemote(28) });
  await refreshPortfolio({
    ...i,
    deps: noRemote(44),
    now: i.now + 6 * 24 * 60 * 60 * 1000,
  });

  const [c] = await i.db.readConcerns();
  expect(c?.key).toBe("/p/airlock|no-remote");
  expect(c?.firstValue).toBe(28);
  expect(c?.lastValue).toBe(44);
  expect(c?.firstSeenAt).toBe(i.now); // the age survived the second run
  expect(c?.resolvedAt).toBeNull();
});

it("resolves the concern once the repository gains a remote", async () => {
  const i = input({ recentFolders: ["/p/airlock"], openTabRoots: [] });
  await refreshPortfolio({
    ...i,
    deps: deps({
      status: async () => ({
        branch: { head: "main", upstream: null, ahead: 5, behind: 0 },
        staged: [],
        unstaged: [],
        untracked: [],
      }),
    }),
  });
  expect((await i.db.readConcerns())[0]?.resolvedAt).toBeNull();

  await refreshPortfolio({ ...i, now: i.now + 1000 }); // default deps have an upstream
  const [c] = await i.db.readConcerns();
  // Kept, not deleted: "was this ever a problem?" has to have an answer.
  expect(c?.resolvedAt).toBe(i.now + 1000);
});
