// ASCII comments only. Atlas's store. SQLite via node:sqlite, which ships
// INSIDE Electron's Node (24.15.0 on Electron 42) -- so there is NO native
// dependency and no .node binary to bundle. better-sqlite3 is deliberately not
// used: a native module here is a documented packaging hazard that neither
// `npm test` nor `npm run typecheck` would catch.
//
// Main-process only. The renderer receives projections over IPC.

import { DatabaseSync } from "node:sqlite";
import type { AtlasProject, RootSnapshot } from "@airlock/agent-core";

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
