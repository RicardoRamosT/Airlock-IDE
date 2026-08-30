// ASCII comments only. Atlas's store. SQLite via node:sqlite, which ships
// INSIDE Electron's Node (24.15.0 on Electron 42) -- so there is NO native
// dependency and no .node binary to bundle. better-sqlite3 is deliberately not
// used: a native module here is a documented packaging hazard that neither
// `npm test` nor `npm run typecheck` would catch.
//
// Main-process only. The renderer receives projections over IPC.

import { DatabaseSync } from "node:sqlite";
import type {
  AtlasFact,
  AtlasProject,
  RootSnapshot,
  Turn,
} from "@airlock/agent-core";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS project (
  root       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  addedAt    INTEGER NOT NULL,
  lastSeenAt INTEGER NOT NULL,
  missing    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS snapshot (
  day  TEXT PRIMARY KEY,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS brief (
  day       TEXT PRIMARY KEY,
  text      TEXT NOT NULL,
  costUsd   REAL NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS fact (
  id           TEXT PRIMARY KEY,
  project      TEXT,
  kind         TEXT NOT NULL,
  value        TEXT NOT NULL,
  verbatim     TEXT NOT NULL,
  saidAt       INTEGER NOT NULL,
  supersededAt INTEGER
);
CREATE TABLE IF NOT EXISTS turn (
  seq  INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`;

// Idempotent: CREATE TABLE IF NOT EXISTS means reopening an existing database
// is safe and never destructive.
export function openAtlasDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

export function readRegistry(db: DatabaseSync): AtlasProject[] {
  const rows = db
    .prepare(
      "SELECT root, name, addedAt, lastSeenAt, missing FROM project ORDER BY addedAt, root",
    )
    .all() as {
    root: string;
    name: string;
    addedAt: number;
    lastSeenAt: number;
    missing: number;
  }[];
  // SQLite has no boolean type. Convert at the boundary so no caller ever sees
  // a 0/1 where it expects a boolean.
  return rows.map((r) => ({
    root: r.root,
    name: r.name,
    addedAt: r.addedAt,
    lastSeenAt: r.lastSeenAt,
    missing: r.missing !== 0,
  }));
}

// Wholesale replace. The registry is small (one row per project) and is always
// produced as a complete list by mergeRegistry, so a diff would add risk for no
// gain -- and a partial write could resurrect a row the caller removed.
export function writeRegistry(
  db: DatabaseSync,
  projects: readonly AtlasProject[],
): void {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM project").run();
    const ins = db.prepare(
      "INSERT INTO project (root, name, addedAt, lastSeenAt, missing) VALUES (?, ?, ?, ?, ?)",
    );
    for (const p of projects) {
      ins.run(p.root, p.name, p.addedAt, p.lastSeenAt, p.missing ? 1 : 0);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function saveSnapshot(
  db: DatabaseSync,
  day: string,
  roots: readonly RootSnapshot[],
): void {
  db.prepare(
    "INSERT INTO snapshot (day, json) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET json = excluded.json",
  ).run(day, JSON.stringify(roots));
}

// null means NO SNAPSHOT WAS EVER TAKEN for this day; [] means one was taken
// and the portfolio was empty. Conflating the two is the mistake CLAUDE.md's
// loading-states section warns about.
export function readSnapshot(
  db: DatabaseSync,
  day: string,
): RootSnapshot[] | null {
  const row = db.prepare("SELECT json FROM snapshot WHERE day = ?").get(day) as
    | { json: string }
    | undefined;
  if (!row) return null;
  try {
    const parsed: unknown = JSON.parse(row.json);
    return Array.isArray(parsed) ? (parsed as RootSnapshot[]) : null;
  } catch {
    return null;
  }
}

// Local-time day key. The arrival trigger compares calendar days, so this must
// follow the USER's clock: 02:00 UTC is still yesterday at UTC-6.
export function dayKey(at: number, tzOffsetMinutes: number): string {
  const shifted = new Date(at + tzOffsetMinutes * 60_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface StoredBrief {
  day: string;
  text: string;
  costUsd: number;
  createdAt: number;
}

export function saveBrief(db: DatabaseSync, brief: StoredBrief): void {
  db.prepare(
    "INSERT INTO brief (day, text, costUsd, createdAt) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(day) DO UPDATE SET text = excluded.text, costUsd = excluded.costUsd, createdAt = excluded.createdAt",
  ).run(brief.day, brief.text, brief.costUsd, brief.createdAt);
}

export function readBrief(db: DatabaseSync, day: string): StoredBrief | null {
  const row = db
    .prepare("SELECT day, text, costUsd, createdAt FROM brief WHERE day = ?")
    .get(day) as StoredBrief | undefined;
  return row ?? null;
}

// MAX, not "last inserted": days can be written out of order if a compose is
// slow, and the trigger compares against the most recent day that exists.
export function lastBriefDay(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT MAX(day) AS day FROM brief").get() as
    | { day: string | null }
    | undefined;
  return row?.day ?? null;
}

export function readFacts(db: DatabaseSync): AtlasFact[] {
  const rows = db
    .prepare(
      "SELECT id, project, kind, value, verbatim, saidAt, supersededAt FROM fact ORDER BY saidAt, id",
    )
    .all() as {
    id: string;
    project: string | null;
    kind: string;
    value: string;
    verbatim: string;
    saidAt: number;
    supersededAt: number | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    project: r.project,
    kind: r.kind as AtlasFact["kind"],
    value: r.value,
    verbatim: r.verbatim,
    saidAt: r.saidAt,
    supersededAt: r.supersededAt,
  }));
}

// Wholesale replace, like the registry: mergeFacts always produces the complete
// list, and a partial write could resurrect a superseded row.
export function writeFacts(
  db: DatabaseSync,
  facts: readonly AtlasFact[],
): void {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM fact").run();
    const ins = db.prepare(
      "INSERT INTO fact (id, project, kind, value, verbatim, saidAt, supersededAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const f of facts) {
      ins.run(
        f.id,
        f.project,
        f.kind,
        f.value,
        f.verbatim,
        f.saidAt,
        f.supersededAt,
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function appendTurn(db: DatabaseSync, turn: Turn, at: number): void {
  db.prepare("INSERT INTO turn (role, text, at) VALUES (?, ?, ?)").run(
    turn.role,
    turn.text,
    at,
  );
}

// The most recent `limit` turns, returned OLDEST FIRST so the caller can append
// them to a prompt in reading order. Turns older than the conversation
// boundary are excluded -- that is what "New chat" means.
export function readTurns(db: DatabaseSync, limit: number): Turn[] {
  const since = readChatSince(db);
  const rows = db
    .prepare(
      "SELECT role, text FROM turn WHERE at >= ? ORDER BY seq DESC LIMIT ?",
    )
    .all(since, limit) as { role: string; text: string }[];
  return rows
    .reverse()
    .map((r) => ({ role: r.role as Turn["role"], text: r.text }));
}

export function readAskedDay(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT v FROM kv WHERE k = 'askedDay'").get() as
    | { v: string }
    | undefined;
  return row?.v ?? null;
}

export function writeAskedDay(db: DatabaseSync, day: string): void {
  db.prepare(
    "INSERT INTO kv (k, v) VALUES ('askedDay', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
  ).run(day);
}

// The conversation boundary. "New chat" moves it to now, so the transcript
// starts empty -- but nothing is deleted, and the FACTS table is untouched, so
// everything Atlas has learned about the user carries over. A fresh chat with
// no memory would be a worse assistant, not a cleaner one.
export function readChatSince(db: DatabaseSync): number {
  const row = db.prepare("SELECT v FROM kv WHERE k = 'chatSince'").get() as
    | { v: string }
    | undefined;
  const n = row ? Number.parseInt(row.v, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function writeChatSince(db: DatabaseSync, at: number): void {
  db.prepare(
    "INSERT INTO kv (k, v) VALUES ('chatSince', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
  ).run(String(at));
}
