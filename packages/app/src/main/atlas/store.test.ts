import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AtlasFact,
  AtlasProject,
  RootSnapshot,
} from "@airlock/agent-core";
import { expect, it } from "vitest";
import {
  appendTurn,
  appendTurns,
  dayKey,
  lastBriefDay,
  listSessions,
  openAtlasDb,
  readAskedDay,
  readBrief,
  readFacts,
  readRegistry,
  readSnapshot,
  readTurns,
  resumeSession,
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
  saveSnapshot(d, "2026-08-30", 0, []);
  expect(readSnapshot(d, "2026-08-30")).toEqual([]);
});

it("round-trips a snapshot including commits", () => {
  const d = db();
  saveSnapshot(d, "2026-08-29", 0, [
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
  saveSnapshot(d, "2026-08-30", 0, [snap("/p/a")]);
  saveSnapshot(d, "2026-08-30", 0, [snap("/p/a"), snap("/p/b")]);
  expect(readSnapshot(d, "2026-08-30")).toHaveLength(2);
});

it("keeps days separate", () => {
  const d = db();
  saveSnapshot(d, "2026-08-29", 0, [snap("/p/a")]);
  saveSnapshot(d, "2026-08-30", 0, [snap("/p/b")]);
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

it("writes a user turn and its reply as ONE unit, or not at all", () => {
  // AirLock aborted between the two appendTurn calls on 2026-08-30 (a Node
  // CHECK inside node:sqlite's bind, crash report AirLock-2026-08-30-163118),
  // leaving a user turn with no reply in the live database -- exactly the
  // "poisoned history" conversation.ts's own header forbids. Two statements
  // with no transaction is what made a crash able to corrupt the transcript.
  const d = db();
  expect(
    () =>
      appendTurns(
        d,
        [
          { role: "user", text: "what should I do?" },
          // Forces the SECOND insert to fail, standing in for the abort. It
          // is `role` and not `text` because text is now bound as bytes, and
          // TextEncoder turns undefined into "" rather than failing.
          { role: undefined as unknown as "atlas", text: "the reply" },
        ],
        1000,
      ),
    // Match the BIND failure specifically: a bare .toThrow() also passes when
    // appendTurns does not exist at all, which is a vacuous test.
  ).toThrow(/bound to SQLite/);
  // Neither turn survives: no dangling user message.
  expect(readTurns(d, 10)).toEqual([]);
});

it("stores text as real TEXT even though it is bound as bytes", () => {
  // Text is bound as a Uint8Array with CAST(? AS TEXT) to keep it out of Node's
  // Utf8Value, whose capacity assertion aborted the process twice. The stored
  // value must be indistinguishable from a plain string bind, so this pins the
  // column TYPE as well as the round-trip.
  const d = db();
  appendTurns(d, [{ role: "atlas", text: "hello" }], 1000);
  const row = d
    .prepare("SELECT typeof(text) AS ty FROM turn LIMIT 1")
    .get() as { ty: string };
  expect(row.ty).toBe("text");
});

it("round-trips unicode, newlines and quotes through the byte bind", () => {
  const tricky =
    'unicode e\u0301n \u4e2d\u6587 \u00b7 emoji \ud83d\ude80\n"quotes"\ttabs';
  const d = db();
  appendTurns(d, [{ role: "atlas", text: tricky }], 1000);
  expect(readTurns(d, 10)[0]?.text).toBe(tricky);
});

it("round-trips a large reply, the size class that actually crashed", () => {
  const big = "x".repeat(60_000);
  const d = db();
  appendTurns(d, [{ role: "atlas", text: big }], 1000);
  expect(readTurns(d, 10)[0]?.text).toBe(big);
});

it("round-trips text through briefs, facts and snapshots too", () => {
  const d = db();
  const odd = "caf\u00e9 \u2014 90% \u2713";
  saveBrief(d, { day: "2026-08-30", text: odd, costUsd: 0, createdAt: 1 });
  expect(readBrief(d, "2026-08-30")?.text).toBe(odd);
  writeFacts(d, [aFact({ value: odd, verbatim: odd })]);
  expect(readFacts(d)[0]?.value).toBe(odd);
  expect(readFacts(d)[0]?.verbatim).toBe(odd);
  saveSnapshot(d, "2026-08-30", 0, [snap("/p/caf\u00e9")]);
  expect(readSnapshot(d, "2026-08-30")?.[0]?.root).toBe("/p/caf\u00e9");
});

it("commits both turns together on the happy path", () => {
  const d = db();
  appendTurns(
    d,
    [
      { role: "user", text: "q" },
      { role: "atlas", text: "a" },
    ],
    1000,
  );
  expect(readTurns(d, 10).map((t) => t.text)).toEqual(["q", "a"]);
});

it("stamps both turns with the SAME session, so a pair cannot straddle a boundary", () => {
  const d = db();
  writeChatSince(d, 500);
  appendTurns(
    d,
    [
      { role: "user", text: "q" },
      { role: "atlas", text: "a" },
    ],
    1000,
  );
  expect(readTurns(d, 10)).toHaveLength(2);
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

it("lists past conversations newest-first, with a preview and a count", () => {
  const d = db();
  writeChatSince(d, 100);
  appendTurn(d, { role: "user", text: "first question" }, 110);
  appendTurn(d, { role: "atlas", text: "an answer" }, 120);
  writeChatSince(d, 200);
  appendTurn(d, { role: "user", text: "second question" }, 210);

  const out = listSessions(d);
  expect(out.map((x) => x.session)).toEqual([200, 100]);
  expect(out[0]).toMatchObject({ preview: "second question", turns: 1 });
  expect(out[1]).toMatchObject({ preview: "first question", turns: 2 });
});

it("reopens a past conversation instead of only showing it", () => {
  // "In case I want to go back into a chat" -- resuming makes it active again,
  // so it can simply be continued.
  const d = db();
  writeChatSince(d, 100);
  appendTurn(d, { role: "user", text: "old thread" }, 110);
  writeChatSince(d, 200);
  appendTurn(d, { role: "user", text: "new thread" }, 210);
  expect(readTurns(d, 10).map((t) => t.text)).toEqual(["new thread"]);

  resumeSession(d, 100);
  expect(readTurns(d, 10).map((t) => t.text)).toEqual(["old thread"]);
  // And the newer one is still there to go back to.
  resumeSession(d, 200);
  expect(readTurns(d, 10).map((t) => t.text)).toEqual(["new thread"]);
});

it("groups by the session a turn was written in, not by timestamp", () => {
  // A turn keeps its session even if the boundary later moves past its time.
  const d = db();
  writeChatSince(d, 100);
  appendTurn(d, { role: "user", text: "belongs to 100" }, 500);
  writeChatSince(d, 300);
  expect(readTurns(d, 10)).toEqual([]);
  resumeSession(d, 100);
  expect(readTurns(d, 10).map((t) => t.text)).toEqual(["belongs to 100"]);
});

it("REFUSES a snapshot narrower than the window asked for", () => {
  // The bug this pins: the chat wanted a week, found a snapshot collected over
  // 24 hours, and reported its "1 commit" as the week's work. A narrower cache
  // is not a hit, it is a wrong answer.
  const d = db();
  const DAY = 24 * 60 * 60 * 1000;
  const now = 1_000_000_000_000;
  saveSnapshot(d, "2026-08-30", now - DAY, [snap("/p/a")]);
  expect(readSnapshot(d, "2026-08-30", now - 7 * DAY)).toBeNull();
  // Its own window is still a hit.
  expect(readSnapshot(d, "2026-08-30", now - DAY)).toHaveLength(1);
});

it("reuses a WIDER snapshot, trimmed to the window asked for", () => {
  const d = db();
  const DAY = 24 * 60 * 60 * 1000;
  const now = 1_000_000_000_000;
  saveSnapshot(d, "2026-08-30", now - 7 * DAY, [
    snap("/p/a", {
      commits: [
        { hash: "old", at: now - 5 * DAY, subject: "five days ago" },
        { hash: "new", at: now - 2 * 60 * 60 * 1000, subject: "today" },
      ],
    }),
  ]);
  const out = readSnapshot(d, "2026-08-30", now - DAY);
  expect(out?.[0]?.commits.map((c) => c.hash)).toEqual(["new"]);
});

it("re-collects a legacy snapshot that recorded no window", () => {
  // Rows written before the window was stored cannot be trusted to cover
  // anything, so they must not satisfy a cache lookup.
  const d = db();
  d.prepare("INSERT INTO snapshot (day, json) VALUES (?, ?)").run(
    "2026-08-30",
    JSON.stringify([{ root: "/p/a" }]),
  );
  expect(readSnapshot(d, "2026-08-30", 0)).toBeNull();
});

it("MIGRATES a database whose turn table predates the session column", () => {
  // The bug this pins: turn.session was added to the schema, but CREATE TABLE
  // IF NOT EXISTS never alters an existing table, so every database created
  // before that change lacked the column and every chat died with
  // "no such column: session" before reaching Claude.
  //
  // A real file, not :memory: -- an in-memory database cannot be REOPENED, and
  // reopening is the whole behaviour under test.
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "atlas-mig-")),
    "atlas.db",
  );
  const first = openAtlasDb(file);
  first.exec("DROP TABLE turn");
  first.exec(
    "CREATE TABLE turn (seq INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL)",
  );
  first
    .prepare("INSERT INTO turn (role, text, at) VALUES ('user','legacy',1)")
    .run();
  first.close();

  // Opening it again must repair the shape without losing the row.
  const second = openAtlasDb(file);
  const cols = (
    second.prepare("PRAGMA table_info(turn)").all() as { name: string }[]
  ).map((c) => c.name);
  expect(cols).toContain("session");
  expect(readTurns(second, 10).map((t) => t.text)).toEqual(["legacy"]);

  // And a third open must not try to add it twice.
  second.close();
  expect(() => openAtlasDb(file).close()).not.toThrow();
});
