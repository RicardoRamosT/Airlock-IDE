import type { CollectDeps } from "@airlock/agent-core";
import { expect, it, vi } from "vitest";
import { lastBriefDay, openAtlasDb, readBrief } from "./store";
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
  db: openAtlasDb(":memory:"),
  collect: collect(),
  spawn: async () => okJson,
  now: () => Date.UTC(2026, 7, 30, 18, 0, 0),
  tzOffsetMinutes: () => -360,
  roots: () => ["/p/a"],
  enabled: () => true,
  acknowledged: () => true,
  onBriefReady: () => {},
  ...over,
});

it("composes and stores a brief on the first arrival of a day", async () => {
  const d = deps();
  expect(await maybeCompose(d)).toBe(true);
  expect(readBrief(d.db, "2026-08-30")?.text).toContain("calendar");
  expect(lastBriefDay(d.db)).toBe("2026-08-30");
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
  expect(lastBriefDay(d.db)).toBeNull();
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
  const exists = vi.fn(c.exists);
  await maybeCompose(deps({ collect: { ...c, exists } }));
  expect(exists).toHaveBeenCalled();
});
