import { expect, it, vi } from "vitest";
import type { GitStatus } from "../git/status";
import { type CollectDeps, collectAll, collectRoot } from "./collect";

const status = (
  over: Partial<GitStatus["branch"]> = {},
  files = 0,
): GitStatus => ({
  branch: {
    head: "main",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    ...over,
  },
  staged: [],
  unstaged: Array.from({ length: files }, (_, i) => ({
    path: `f${i}`,
    index: ".",
    worktree: "M",
    origPath: null,
  })),
  untracked: [],
});

const deps = (over: Partial<CollectDeps> = {}): CollectDeps => ({
  exists: async () => true,
  isRepo: async () => true,
  status: async () => status(),
  log: async () => [],
  ...over,
});

it("collects branch, upstream, ahead and dirty count for a normal repo", async () => {
  const snap = await collectRoot(
    deps({ status: async () => status({ ahead: 34 }, 3) }),
    "/p/muros",
    0,
  );
  expect(snap).toMatchObject({
    root: "/p/muros",
    missing: false,
    isRepo: true,
    branch: "main",
    upstream: "origin/main",
    ahead: 34,
    dirty: 3,
  });
});

it("counts staged, unstaged and untracked together as dirty", async () => {
  const s = status();
  s.staged = [{ path: "a", index: "M", worktree: ".", origPath: null }];
  s.unstaged = [{ path: "b", index: ".", worktree: "M", origPath: null }];
  s.untracked = ["c", "d"];
  const snap = await collectRoot(deps({ status: async () => s }), "/p/a", 0);
  expect(snap.dirty).toBe(4);
});

it("marks a vanished root missing and never calls git on it", async () => {
  // The author's own recents contain a path that no longer exists.
  const isRepo = vi.fn(async () => true);
  const snap = await collectRoot(
    deps({ exists: async () => false, isRepo }),
    "/p/gone",
    0,
  );
  expect(snap).toMatchObject({
    missing: true,
    isRepo: false,
    branch: null,
    dirty: 0,
  });
  expect(isRepo).not.toHaveBeenCalled();
});

it("handles a root that exists but is not a git repository", async () => {
  // Also real today: 'Keyview Track' is a known root with no .git directory.
  const snap = await collectRoot(
    deps({ isRepo: async () => false }),
    "/p/plain",
    0,
  );
  expect(snap).toMatchObject({
    missing: false,
    isRepo: false,
    branch: null,
    commits: [],
  });
});

it("reports null upstream for a repo with no remote tracking branch", async () => {
  const snap = await collectRoot(
    deps({ status: async () => status({ upstream: null }) }),
    "/p/local",
    0,
  );
  expect(snap.upstream).toBeNull();
  expect(snap.ahead).toBe(0);
});

it("degrades to a repo-shaped snapshot when git status throws", async () => {
  // A single broken repository must never blank the whole portfolio.
  const snap = await collectRoot(
    deps({
      status: async () => {
        throw new Error("fatal: not a git repository");
      },
    }),
    "/p/broken",
    0,
  );
  expect(snap).toMatchObject({
    isRepo: true,
    branch: null,
    dirty: 0,
    commits: [],
  });
});

it("still returns status when the log call throws", async () => {
  const snap = await collectRoot(
    deps({
      log: async () => {
        throw new Error("boom");
      },
    }),
    "/p/a",
    0,
  );
  expect(snap.branch).toBe("main");
  expect(snap.commits).toEqual([]);
});

it("collects every root and preserves input order", async () => {
  const out = await collectAll(deps(), ["/p/a", "/p/b", "/p/c"], 0);
  expect(out.map((s) => s.root)).toEqual(["/p/a", "/p/b", "/p/c"]);
});

it("bounds concurrency so a large portfolio cannot spawn unbounded work", async () => {
  // Some users have hundreds of projects (spec 15.3).
  let live = 0;
  let peak = 0;
  const d = deps({
    exists: async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live -= 1;
      return true;
    },
  });
  const roots = Array.from({ length: 20 }, (_, i) => `/p/${i}`);
  const out = await collectAll(d, roots, 0, 4);
  expect(out).toHaveLength(20);
  expect(peak).toBeLessThanOrEqual(4);
});
