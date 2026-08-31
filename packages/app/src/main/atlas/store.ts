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
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  role    TEXT NOT NULL,
  text    TEXT NOT NULL,
  at      INTEGER NOT NULL,
  session INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`;

// Columns added to a table that ALREADY EXISTS. CREATE TABLE IF NOT EXISTS is
// idempotent for CREATION and does nothing for EVOLUTION: adding a column to
// the schema above leaves every existing database without it. That is exactly
// what happened with turn.session -- every chat died on "no such column:
// session" before it ever reached Claude. New columns go here, not only above.
const ADDED_COLUMNS: { table: string; column: string; ddl: string }[] = [
  {
    table: "turn",
    column: "session",
    ddl: "ALTER TABLE turn ADD COLUMN session INTEGER NOT NULL DEFAULT 0",
  },
  {
    table: "turn",
    column: "pending",
    ddl: "ALTER TABLE turn ADD COLUMN pending INTEGER NOT NULL DEFAULT 0",
  },
];

function migrate(db: DatabaseSync): void {
  for (const { table, column, ddl } of ADDED_COLUMNS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[];
    if (cols.length === 0) continue; // table not created yet; SCHEMA has it
    if (cols.some((c) => c.name === column)) continue;
    db.exec(ddl);
  }
}

// Safe to reopen: CREATE TABLE IF NOT EXISTS creates what is missing, then
// migrate() adds columns to tables that predate them.
export function openAtlasDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// TEXT IS BOUND AS BYTES, NEVER AS A JS STRING.
//
// node:sqlite's BindValue constructs node::Utf8Value for every STRING bind, and
// that constructor's capacity assertion (util.h:454, "(length + 1) <=
// capacity()") calls abort(). It has now fired twice on this machine while
// binding a model reply: once killing AirLock outright (crash report
// AirLock-2026-08-30-163118) and once killing the database host after that was
// isolated (AirLock Helper-2026-08-30-185123) -- identical stacks,
// Run -> BindParams -> BindValue -> Utf8Value -> Assert. The value is not at
// fault: the reply was 3 KB of well-formed UTF-8, and replaying that exact bind
// 20000 times reproduces nothing. Node is simply mispredicting a UTF-8 length.
//
// A Uint8Array takes BindValue's BLOB branch instead, which never predicts a
// UTF-8 length, and CAST(? AS TEXT) converts the bytes back using the database
// encoding. Verified byte-identical to a string bind for ASCII, unicode,
// newlines/quotes and a 60 KB value, with typeof() still "text" and
// `WHERE col = ?` against a plain string still matching.
//
// Applied to the model- and user-controlled values, which is where it fires.
// Short internal keys (day keys, roles, op names) still bind as strings.
const TEXT_ENCODER = new TextEncoder();
function bytes(s: string): Uint8Array {
  return TEXT_ENCODER.encode(s);
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

// The window is stored WITH the snapshot. Without it, a snapshot collected over
// 24 hours was indistinguishable from one collected over a week, so the chat
// reused the daily snapshot and reported "1 commit" as a week's work. The
// collector was right; the cache was lying about what it covered.
export function saveSnapshot(
  db: DatabaseSync,
  day: string,
  sinceMs: number,
  roots: readonly RootSnapshot[],
): void {
  db.prepare(
    "INSERT INTO snapshot (day, json) VALUES (?, CAST(? AS TEXT)) ON CONFLICT(day) DO UPDATE SET json = excluded.json",
  ).run(day, bytes(JSON.stringify({ sinceMs, roots })));
}

// null means NO SNAPSHOT WAS EVER TAKEN for this day; [] means one was taken
// and the portfolio was empty. Conflating the two is the mistake CLAUDE.md's
// loading-states section warns about.
// Returns the snapshot only if it covers AT LEAST as far back as `wantedSince`;
// a narrower one is not a cache hit, it is a wrong answer. A wider one is
// usable, with its commits trimmed to the window actually asked for.
export function readSnapshot(
  db: DatabaseSync,
  day: string,
  wantedSince = Number.POSITIVE_INFINITY,
): RootSnapshot[] | null {
  const row = db.prepare("SELECT json FROM snapshot WHERE day = ?").get(day) as
    | { json: string }
    | undefined;
  if (!row) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.json);
  } catch {
    return null;
  }
  // Older rows were a bare array with no window recorded. Treat them as
  // covering nothing, so they are re-collected rather than trusted.
  if (Array.isArray(parsed)) return null;
  if (!parsed || typeof parsed !== "object") return null;
  const env = parsed as { sinceMs?: unknown; roots?: unknown };
  if (typeof env.sinceMs !== "number" || !Array.isArray(env.roots)) return null;
  if (env.sinceMs > wantedSince) return null; // too narrow

  const roots = env.roots as RootSnapshot[];
  if (!Number.isFinite(wantedSince)) return roots;
  return roots.map((r) => ({
    ...r,
    commits: r.commits.filter((c) => c.at >= wantedSince),
  }));
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
    "INSERT INTO brief (day, text, costUsd, createdAt) VALUES (?, CAST(? AS TEXT), ?, ?) " +
      "ON CONFLICT(day) DO UPDATE SET text = excluded.text, costUsd = excluded.costUsd, createdAt = excluded.createdAt",
  ).run(brief.day, bytes(brief.text), brief.costUsd, brief.createdAt);
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
      "INSERT INTO fact (id, project, kind, value, verbatim, saidAt, supersededAt) VALUES (?, ?, ?, CAST(? AS TEXT), CAST(? AS TEXT), ?, ?)",
    );
    for (const f of facts) {
      ins.run(
        f.id,
        f.project,
        f.kind,
        bytes(f.value),
        bytes(f.verbatim),
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
  appendTurns(db, [turn], at);
}

// A user message and its reply are ONE unit and are written in ONE transaction.
//
// They used to be two bare INSERTs. On 2026-08-30 the process aborted between
// them -- a CHECK inside node:sqlite's own parameter binding, see the crash
// report AirLock-2026-08-30-163118 -- and the live database was left holding a
// user turn whose reply never landed. That is precisely the "half-written turn
// ... would poison the history that every later turn resends" state that
// conversation.ts's header declares must not exist; the guard there covers a
// failed SPAWN and cannot cover a failed WRITE. Only the transaction can.
//
// This also protects against an abort rather than merely an exception: an
// uncommitted transaction is rolled back when SQLite next opens the file, so a
// crash mid-pair leaves NEITHER turn instead of a dangling one.
export function appendTurns(
  db: DatabaseSync,
  turns: readonly Turn[],
  at: number,
): void {
  if (turns.length === 0) return;
  // Read the boundary ONCE, outside the loop: the active boundary doubles as
  // the session id, and reading it per turn would let a pair straddle two
  // conversations if "New chat" landed between the two inserts.
  const session = readChatSince(db);
  db.exec("BEGIN");
  try {
    const ins = db.prepare(
      "INSERT INTO turn (role, text, at, session) VALUES (?, CAST(? AS TEXT), ?, ?)",
    );
    for (const t of turns) ins.run(t.role, bytes(t.text), at, session);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// A user turn's answer state. The original design wrote BOTH turns only after
// the model returned, on the reasoning that "a half-written turn -- a user
// message with no reply -- would poison the history". That was right about the
// risk and wrong about the remedy: a bare user turn is only ambiguous because
// it cannot SAY it is still in flight.
//
// The cost of deferring was that an in-flight message existed nowhere but the
// panel's React state. Closing the panel destroyed it; reopening read the
// database and found nothing; it reappeared minutes later when the run
// finished. Reported by the user as "if I talk it is not saved until claude
// responds".
export const TURN_SETTLED = 0; // answered, or an ordinary historical turn
export const TURN_PENDING = 1; // asked, reply in flight
export const TURN_UNANSWERED = 2; // the reply is never coming

export type TurnState = "settled" | "pending" | "unanswered";

function turnState(v: number): TurnState {
  if (v === TURN_PENDING) return "pending";
  if (v === TURN_UNANSWERED) return "unanswered";
  return "settled";
}

// Write the user's message NOW, before the model is even spawned, and return
// its seq so the reply can complete it.
export function beginTurn(db: DatabaseSync, text: string, at: number): number {
  db.prepare(
    "INSERT INTO turn (role, text, at, session, pending) VALUES ('user', CAST(? AS TEXT), ?, ?, ?)",
  ).run(bytes(text), at, readChatSince(db), TURN_PENDING);
  const row = db.prepare("SELECT last_insert_rowid() AS seq").get() as {
    seq: number;
  };
  return row.seq;
}

// The reply landed: append it and settle the question, in ONE transaction so a
// crash between them cannot leave a reply with no question or the reverse.
export function completeTurn(
  db: DatabaseSync,
  seq: number,
  reply: string,
  at: number,
): void {
  const session = readChatSince(db);
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO turn (role, text, at, session, pending) VALUES ('atlas', CAST(? AS TEXT), ?, ?, ?)",
    ).run(bytes(reply), at, session, TURN_SETTLED);
    db.prepare("UPDATE turn SET pending = ? WHERE seq = ?").run(
      TURN_SETTLED,
      seq,
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// The run failed. The question was real and stays visible; only its state
// changes, so the panel stops showing a working indicator for it.
export function abandonTurn(db: DatabaseSync, seq: number): void {
  db.prepare("UPDATE turn SET pending = ? WHERE seq = ?").run(
    TURN_UNANSWERED,
    seq,
  );
}

// The user RETRACTED the question (Escape). Unlike a failure, this one is
// removed: the renderer hands the message back to the input box, so keeping it
// in the log too would show the same sentence in two places and make a
// deliberate retraction look like a lost turn. Nothing was answered and nothing
// is being hidden -- the text is in the composer, where the user put it.
export function discardTurn(db: DatabaseSync, seq: number): void {
  db.prepare("DELETE FROM turn WHERE seq = ? AND pending = ?").run(
    seq,
    TURN_PENDING,
  );
}

// Called once when the store opens. A turn still PENDING was left that way by a
// process that no longer exists, so nothing will ever complete it -- without
// this it would show a working indicator forever.
export function markInterruptedTurns(db: DatabaseSync): number {
  const before = (
    db
      .prepare("SELECT COUNT(*) AS n FROM turn WHERE pending = ?")
      .get(TURN_PENDING) as { n: number }
  ).n;
  if (before > 0) {
    db.prepare("UPDATE turn SET pending = ? WHERE pending = ?").run(
      TURN_UNANSWERED,
      TURN_PENDING,
    );
  }
  return before;
}

// The most recent `limit` turns, returned OLDEST FIRST so the caller can append
// them to a prompt in reading order. Turns older than the conversation
// boundary are excluded -- that is what "New chat" means.
export function readTurns(db: DatabaseSync, limit: number): Turn[] {
  const session = readChatSince(db);
  const rows = db
    .prepare(
      "SELECT role, text, pending FROM turn WHERE session = ? ORDER BY seq DESC LIMIT ?",
    )
    .all(session, limit) as {
    role: string;
    text: string;
    pending: number;
  }[];
  return rows.reverse().map((r) => ({
    role: r.role as Turn["role"],
    text: r.text,
    pending: turnState(r.pending),
  }));
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

export interface ChatSession {
  session: number; // the boundary value that identifies it
  startedAt: number; // epoch ms of its first turn
  turns: number;
  preview: string; // the user's opening message, for the list
}

// Past conversations, newest first. Nothing is ever deleted, so "New chat"
// leaves a browsable trail rather than throwing work away.
export function listSessions(db: DatabaseSync, limit = 30): ChatSession[] {
  return db
    .prepare(
      "SELECT session, MIN(at) AS startedAt, COUNT(*) AS turns, " +
        "(SELECT text FROM turn t2 WHERE t2.session = t.session AND t2.role = 'user' ORDER BY seq LIMIT 1) AS preview " +
        "FROM turn t GROUP BY session ORDER BY startedAt DESC LIMIT ?",
    )
    .all(limit) as unknown as ChatSession[];
}

// Reopen a past conversation: point the boundary back at it, so it becomes the
// active session again and can simply be continued.
export function resumeSession(db: DatabaseSync, session: number): void {
  writeChatSince(db, session);
}
