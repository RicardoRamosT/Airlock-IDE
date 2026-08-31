// ASCII comments only. The one list of operations the Atlas database exposes
// across the process boundary, plus the types derived from it.
//
// This table is the contract. The HOST looks operations up here by name, and
// the CLIENT's method signatures are computed from the very same object, so a
// renamed store function or a changed argument list is a type error at build
// time rather than an "unknown op" at runtime.
//
// Only functions that TOUCH THE DATABASE belong here. Pure helpers -- dayKey
// above all -- stay ordinary imports: sending a date calculation to another
// process would be pure overhead.

import type { DatabaseSync } from "node:sqlite";
import {
  abandonTurn,
  appendTurns,
  beginTurn,
  completeTurn,
  discardTurn,
  forgetProject,
  lastBriefDay,
  listSessions,
  readAskedDay,
  readBrief,
  readChatSince,
  readConcerns,
  readFacts,
  readRegistry,
  readSnapshot,
  readTurns,
  resumeSession,
  saveBrief,
  saveSnapshot,
  writeAskedDay,
  writeChatSince,
  writeConcerns,
  writeFacts,
  writeRegistry,
} from "./store";

export const DB_OPS = {
  readConcerns,
  writeConcerns,
  beginTurn,
  completeTurn,
  abandonTurn,
  discardTurn,
  readRegistry,
  writeRegistry,
  forgetProject,
  saveSnapshot,
  readSnapshot,
  saveBrief,
  readBrief,
  lastBriefDay,
  readFacts,
  writeFacts,
  appendTurns,
  readTurns,
  readAskedDay,
  writeAskedDay,
  readChatSince,
  writeChatSince,
  listSessions,
  resumeSession,
} satisfies Record<string, (db: DatabaseSync, ...args: never[]) => unknown>;

export type DbOps = typeof DB_OPS;
export type DbOpName = keyof DbOps;

// The caller's view of the store: same names, same arguments minus the handle,
// every result a promise because it now crosses a process boundary.
export type AtlasDb = {
  [K in DbOpName]: DbOps[K] extends (
    db: DatabaseSync,
    ...args: infer A
  ) => infer R
    ? (...args: A) => Promise<R>
    : never;
};

export const DB_OP_NAMES = Object.keys(DB_OPS) as DbOpName[];

// Wire format. Deliberately tiny: an id to correlate the reply, the op name,
// and structured-cloneable arguments.
export interface DbRequest {
  id: number;
  op: DbOpName;
  args: unknown[];
}

export type DbResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

// The same operations against a handle in THIS process. Used by tests, so they
// keep exercising real SQLite and the real store code rather than a mock, while
// production goes through the isolated host. Not used by the app.
export function directDb(db: DatabaseSync): AtlasDb {
  const api = {} as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const op of DB_OP_NAMES) {
    const fn = DB_OPS[op] as (db: DatabaseSync, ...args: unknown[]) => unknown;
    api[op] = async (...args: unknown[]) => fn(db, ...args);
  }
  return api as AtlasDb;
}
