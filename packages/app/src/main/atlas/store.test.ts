import type {
  AtlasFact,
  AtlasProject,
  RootSnapshot,
} from "@airlock/agent-core";
import { expect, it } from "vitest";
import {
  appendTurn,
  dayKey,
  lastBriefDay,
  openAtlasDb,
  readAskedDay,
  readBrief,
  readFacts,
  readRegistry,
  readSnapshot,
  readTurns,
  saveBrief,
  saveSnapshot,
  writeAskedDay,
  writeChatSince,
  writeFacts,
  writeRegistry,
} from "./store";

const db = () => openAtlasDb(":memory:");

const proj = (root: string): AtlasProject => ({
  root,
  name: root.split("/").pop() as string,
  addedAt: 1000,
  lastSeenAt: 2000,
  missing: false,
});

const snap = (
  root: string,
  over: Partial<RootSnapshot> = {},
): RootSnapshot => ({
  root,
  missing: false,
  isRepo: true,
  branch: "main",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  dirty: 0,
  commits: [],
  ...over,
});

it("opens an in-memory database and starts with an empty registry", () => {
  expect(readRegistry(db())).toEqual([]);
});

it("round-trips registry rows", () => {
  const d = db();
  writeRegistry(d, [proj("/p/a"), proj("/p/b")]);
  expect(readRegistry(d).map((p) => p.root)).toEqual(["/p/a", "/p/b"]);
  expect(readRegistry(d)[0]).toMatchObject({ addedAt: 1000, missing: false });
});

it("round-trips the missing flag as a real boolean, not 0 or 1", () => {
  // SQLite has no boolean type; a leaked 0/1 would silently break `if (missing)`.
  const d = db();
  writeRegistry(d, [{ ...proj("/p/gone"), missing: true }]);
  expect(readRegistry(d)[0]?.missing).toBe(true);
});

it("replaces the registry wholesale so a rewrite cannot duplicate rows", () => {
  const d = db();
  writeRegistry(d, [proj("/p/a")]);
  writeRegistry(d, [proj("/p/a"), proj("/p/b")]);
  expect(readRegistry(d)).toHaveLength(2);
});

it("distinguishes a day never snapshotted from a day snapshotted as empty", () => {
  // Three states, per CLAUDE.md: null = never asked, [] = asked, answer is none.
  const d = db();
  expect(readSnapshot(d, "2026-08-30")).toBeNull();
  saveSnapshot(d, "2026-08-30", []);
  expect(readSnapshot(d, "2026-08-30")).toEqual([]);
});

it("round-trips a snapshot including commits", () => {
  const d = db();
  saveSnapshot(d, "2026-08-29", [
    snap("/p/muros", {
      ahead: 34,
      dirty: 2,
      commits: [{ hash: "aaa", at: 1756512000000, subject: "fix: thing" }],
    }),
  ]);
  const out = readSnapshot(d, "2026-08-29");
  expect(out).toHaveLength(1);
  expect(out?.[0]).toMatchObject({ root: "/p/muros", ahead: 34, dirty: 2 });
  expect(out?.[0]?.commits[0]?.subject).toBe("fix: thing");
});

it("overwrites a snapshot for the same day rather than appending", () => {
  const d = db();
  saveSnapshot(d, "2026-08-30", [snap("/p/a")]);
  saveSnapshot(d, "2026-08-30", [snap("/p/a"), snap("/p/b")]);
  expect(readSnapshot(d, "2026-08-30")).toHaveLength(2);
});

it("keeps days separate", () => {
  const d = db();
  saveSnapshot(d, "2026-08-29", [snap("/p/a")]);
  saveSnapshot(d, "2026-08-30", [snap("/p/b")]);
  expect(readSnapshot(d, "2026-08-29")?.[0]?.root).toBe("/p/a");
  expect(readSnapshot(d, "2026-08-30")?.[0]?.root).toBe("/p/b");
});

it("computes the day key in the user's local time, not UTC", () => {
  // 2026-08-30T02:00Z is still Aug 29 for a user at UTC-6. Getting this wrong
  // fires the arrival trigger at the wrong moment for most of the world.
  const at = Date.UTC(2026, 7, 30, 2, 0, 0);
  expect(dayKey(at, -360)).toBe("2026-08-29");
  expect(dayKey(at, 0)).toBe("2026-08-30");
});

it("returns null rather than throwing when stored snapshot JSON is corrupt", () => {
  const d = db();
  d.prepare("INSERT INTO snapshot (day, json) VALUES (?, ?)").run(
    "2026-08-30",
    "{not json",
  );
  expect(readSnapshot(d, "2026-08-30")).toBeNull();
});

it("returns null for lastBriefDay before any brief exists", () => {
  expect(lastBriefDay(db())).toBeNull();
});

it("round-trips a brief", () => {
  const d = db();
  saveBrief(d, {
    day: "2026-08-30",
    text: "YESTERDAY: you shipped the calendar.",
    costUsd: 0.0316,
    createdAt: 1756512000000,
  });
  expect(readBrief(d, "2026-08-30")).toMatchObject({
    day: "2026-08-30",
    text: "YESTERDAY: you shipped the calendar.",
    costUsd: 0.0316,
  });
});

it("returns null for a day with no brief", () => {
  expect(readBrief(db(), "2026-08-30")).toBeNull();
});

it("reports the most recent day, not merely the last written", () => {
  // Days can be written out of order if a compose is slow or backfilled.
  const d = db();
  const b = (day: string) => ({ day, text: "x", costUsd: 0, createdAt: 1 });
  saveBrief(d, b("2026-08-30"));
  saveBrief(d, b("2026-08-28"));
  expect(lastBriefDay(d)).toBe("2026-08-30");
});

it("overwrites a brief for the same day rather than appending", () => {
  const d = db();
  saveBrief(d, { day: "2026-08-30", text: "first", costUsd: 0, createdAt: 1 });
  saveBrief(d, { day: "2026-08-30", text: "second", costUsd: 0, createdAt: 2 });
  expect(readBrief(d, "2026-08-30")?.text).toBe("second");
});

const aFact = (over: Partial<AtlasFact> = {}): AtlasFact => ({
  id: "f0",
  project: "Muros-Estates",
  kind: "deadline",
  value: "2026-09-15",
  verbatim: "Muros is due the 15th",
  saidAt: 1000,
  supersededAt: null,
  ...over,
});

it("starts with no facts", () => {
  expect(readFacts(db())).toEqual([]);
});

it("round-trips a fact including its verbatim source", () => {
  const d = db();
  writeFacts(d, [aFact()]);
  expect(readFacts(d)[0]).toMatchObject({
    project: "Muros-Estates",
    kind: "deadline",
    value: "2026-09-15",
    verbatim: "Muros is due the 15th",
    supersededAt: null,
  });
});

it("round-trips a portfolio-wide fact whose project is null", () => {
  const d = db();
  writeFacts(d, [aFact({ id: "f1", project: null })]);
  expect(readFacts(d)[0]?.project).toBeNull();
});

it("keeps superseded facts, with their timestamp intact", () => {
  // Never silently deleted: "why do you think that?" must be answerable.
  const d = db();
  writeFacts(d, [aFact({ supersededAt: 9000 })]);
  expect(readFacts(d)[0]?.supersededAt).toBe(9000);
});

it("replaces the fact table wholesale so a rewrite cannot duplicate rows", () => {
  const d = db();
  writeFacts(d, [aFact()]);
  writeFacts(d, [aFact(), aFact({ id: "f1", project: "ElArqui" })]);
  expect(readFacts(d)).toHaveLength(2);
});

it("appends turns and reads them back oldest-first", () => {
  const d = db();
  appendTurn(d, { role: "user", text: "first" }, 1);
  appendTurn(d, { role: "atlas", text: "second" }, 2);
  expect(readTurns(d, 10).map((t) => t.text)).toEqual(["first", "second"]);
});

it("returns the MOST RECENT turns when limited, still oldest-first", () => {
  const d = db();
  for (let i = 0; i < 5; i++) {
    appendTurn(d, { role: "user", text: `t${i}` }, i);
  }
  expect(readTurns(d, 2).map((t) => t.text)).toEqual(["t3", "t4"]);
});

it("round-trips the day a staleness question was last asked", () => {
  const d = db();
  expect(readAskedDay(d)).toBeNull();
  writeAskedDay(d, "2026-08-30");
  expect(readAskedDay(d)).toBe("2026-08-30");
  writeAskedDay(d, "2026-08-31");
  expect(readAskedDay(d)).toBe("2026-08-31");
});

it("hides turns before the conversation boundary but keeps the FACTS", () => {
  // "New chat" must clear the transcript without forgetting. A fresh chat with
  // no memory would be a worse assistant, not a cleaner one.
  const d = db();
  appendTurn(d, { role: "user", text: "before" }, 1000);
  writeFacts(d, [aFact()]);
  writeChatSince(d, 2000);
  appendTurn(d, { role: "user", text: "after" }, 3000);

  expect(readTurns(d, 10).map((t) => t.text)).toEqual(["after"]);
  // The memory survived.
  expect(readFacts(d)).toHaveLength(1);
  expect(readFacts(d)[0]?.verbatim).toBe("Muros is due the 15th");
});

it("shows every turn when no boundary has been set", () => {
  const d = db();
  appendTurn(d, { role: "user", text: "one" }, 1);
  appendTurn(d, { role: "atlas", text: "two" }, 2);
  expect(readTurns(d, 10)).toHaveLength(2);
});

it("deletes nothing: a boundary moved back reveals the old turns again", () => {
  const d = db();
  appendTurn(d, { role: "user", text: "old" }, 1000);
  writeChatSince(d, 5000);
  expect(readTurns(d, 10)).toEqual([]);
  writeChatSince(d, 0);
  expect(readTurns(d, 10).map((t) => t.text)).toEqual(["old"]);
});
