import type { CollectDeps } from "@airlock/agent-core";
import { expect, it, vi } from "vitest";
import { directDb } from "./dbOps";
import { openAtlasDb } from "./store";
import { type AtlasDeps, maybeCompose } from "./wire";

const okJson = JSON.stringify({
  type: "result",
  is_error: false,
  result: "YESTERDAY: you shipped the calendar.",
  duration_ms: 1000,
  modelUsage: { "claude-sonnet-5": { costUSD: 0.03 } },
});

const collect = (): CollectDeps => ({
  exists: async () => true,
  isRepo: async () => true,
  status: async () => ({
    branch: { head: "main", upstream: "origin/main", ahead: 0, behind: 0 },
    staged: [],
    unstaged: [],
    untracked: [],
  }),
  log: async () => [],
});

const deps = (over: Partial<AtlasDeps> = {}): AtlasDeps => ({
  db: directDb(openAtlasDb(":memory:")),
  collect: collect(),
  // Every root present unless a test says otherwise. Presence is a separate
  // probe from the collector now, because collect's `exists` is a boolean and
  // cannot say "could not tell" -- see presence.ts.
  probe: async (roots: readonly string[]) =>
    new Map(roots.map((r) => [r, "present" as const])),
  spawn: async () => okJson,
  now: () => Date.UTC(2026, 7, 30, 18, 0, 0),
  tzOffsetMinutes: () => -360,
  roots: () => ["/p/a"],
  recents: () => [],
  enabled: () => true,
  acknowledged: () => true,
  earliestHour: () => 0,
  standup: async () => ({ reports: [], ledgers: [], quiet: 0 }),
  onBriefReady: () => {},
  ...over,
});

it("composes and stores a brief on the first arrival of a day", async () => {
  const d = deps();
  expect(await maybeCompose(d)).toBe(true);
  expect((await d.db.readBrief("2026-08-30"))?.text).toContain("calendar");
  expect(await d.db.lastBriefDay()).toBe("2026-08-30");
});

it("does nothing on a second arrival the same day", async () => {
  const spawn = vi.fn(async () => okJson);
  const d = deps({ spawn });
  await maybeCompose(d);
  expect(await maybeCompose(d)).toBe(false);
  expect(spawn).toHaveBeenCalledTimes(1);
});

it("never spawns claude when Atlas is disabled", async () => {
  const spawn = vi.fn(async () => okJson);
  expect(await maybeCompose(deps({ spawn, enabled: () => false }))).toBe(false);
  expect(spawn).not.toHaveBeenCalled();
});

it("never spawns claude before the cost disclosure is accepted", async () => {
  // Spec 15.2: an API-key user pays real money for this call.
  const spawn = vi.fn(async () => okJson);
  expect(await maybeCompose(deps({ spawn, acknowledged: () => false }))).toBe(
    false,
  );
  expect(spawn).not.toHaveBeenCalled();
});

it("stores no brief when the composer fails, and can retry the same day", async () => {
  const spawn = vi.fn(async () => "garbage");
  const d = deps({ spawn });
  expect(await maybeCompose(d)).toBe(false);
  expect(await d.db.lastBriefDay()).toBeNull();
  // A failure must not consume the day: the next arrival tries again.
  d.spawn = async () => okJson;
  expect(await maybeCompose(d)).toBe(true);
});

it("notifies once when a brief becomes ready", async () => {
  const onBriefReady = vi.fn();
  await maybeCompose(deps({ onBriefReady }));
  expect(onBriefReady).toHaveBeenCalledTimes(1);
  expect(onBriefReady).toHaveBeenCalledWith("2026-08-30");
});

it("refreshes the portfolio before composing, so the brief is current", async () => {
  const c = collect();
  const status = vi.fn(c.status);
  await maybeCompose(deps({ collect: { ...c, status } }));
  expect(status).toHaveBeenCalled();
});

it("starts ONE composer when several arrival events land together", async () => {
  // A lid-open fires browser-window-focus, powerMonitor resume, unlock-screen
  // and activate more or less at once. The guard read `composing` and set it on
  // either side of an await, so all of them passed the check before any of them
  // set the flag -- several concurrent Opus composers, each billed, all writing
  // the same brief.
  //
  // The await only appeared when the store moved into its own process; the
  // guard was sound while lastBriefDay was synchronous.
  const spawn = vi.fn(async () => okJson);
  const d = deps({ spawn });
  const slowDb = {
    ...d.db,
    lastBriefDay: async () => {
      await new Promise((r) => setTimeout(r, 20));
      return null;
    },
  };
  const shared = { ...d, db: slowDb };
  const results = await Promise.all([
    maybeCompose(shared),
    maybeCompose(shared),
    maybeCompose(shared),
    maybeCompose(shared),
  ]);
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(results.filter(Boolean)).toHaveLength(1);
});

it("releases the guard so a LATER arrival can still compose", async () => {
  // Claiming the slot before the await must not strand it: an early return
  // (wrong hour, already composed today) still has to reset the flag.
  const spawn = vi.fn(async () => okJson);
  const d = deps({ spawn, enabled: () => false }); // bails after the claim
  expect(await maybeCompose(d)).toBe(false);
  // Now allowed: if the guard leaked, this second call would be refused.
  expect(await maybeCompose({ ...d, enabled: () => true })).toBe(true);
});

it("runs the standup before composing and stores it", async () => {
  const standup = vi.fn(async () => ({ reports: [], ledgers: [], quiet: 2 }));
  const d = deps({ standup });
  expect(await maybeCompose(d)).toBe(true);
  expect(standup).toHaveBeenCalled();
  expect(await d.db.readReports("2026-08-30")).toEqual({
    reports: [],
    ledgers: [],
    quiet: 2,
  });
});

it("does not re-run the standup when this day already has one", async () => {
  // A compose that failed and is retried must not re-spend the reporters.
  const standup = vi.fn(async () => ({ reports: [], ledgers: [], quiet: 0 }));
  const d = deps({ standup });
  await d.db.saveReports("2026-08-30", [], [], 0);
  expect(await maybeCompose(d)).toBe(true);
  expect(standup).not.toHaveBeenCalled();
});

it("hands the standup only enabled projects", async () => {
  // Opt-in, end to end. A project Atlas knows about but the user has not
  // turned on must never become a ledger or a reporter job.
  const standup = vi.fn(async () => ({ reports: [], ledgers: [], quiet: 0 }));
  const d = deps({ standup, roots: () => ["/p/on", "/p/off"] });
  await d.db.writeRegistry([
    {
      root: "/p/on",
      name: "on",
      addedAt: 1,
      lastSeenAt: 1,
      missing: false,
      enabled: true,
    },
    {
      root: "/p/off",
      name: "off",
      addedAt: 1,
      lastSeenAt: 1,
      missing: false,
      enabled: false,
    },
  ]);
  await maybeCompose(d);
  expect(standup).toHaveBeenCalledWith(["/p/on"], expect.anything());
});

it("skips an enabled project whose folder has vanished", async () => {
  // It cannot be collected, so a reporter call would only report that every
  // probe failed.
  const standup = vi.fn(async () => ({ reports: [], ledgers: [], quiet: 0 }));
  const d = deps({
    standup,
    roots: () => ["/p/gone"],
    collect: { ...collect(), exists: async () => false },
    probe: async (roots: readonly string[]) =>
      new Map(roots.map((r) => [r, "gone" as const])),
  });
  await d.db.writeRegistry([
    {
      root: "/p/gone",
      name: "gone",
      addedAt: 1,
      lastSeenAt: 1,
      missing: true,
      enabled: true,
    },
  ]);
  await maybeCompose(d);
  expect(standup).toHaveBeenCalledWith([], expect.anything());
});
