// ASCII comments only. The Atlas database, running in its OWN process.
//
// WHY THIS PROCESS EXISTS. On 2026-08-30 AirLock died mid-chat: a CHECK inside
// Node's own Utf8Value fired while node:sqlite bound a parameter (crash report
// AirLock-2026-08-30-163118). A failed CHECK calls abort(), which is not a
// throwable error -- no try/catch anywhere can survive it. It took down every
// window, every terminal and every running claude, for a background feature
// writing a chat message.
//
// A worker thread does NOT help, and that was measured rather than assumed:
// abort() raises SIGABRT process-wide, so the parent dies with the worker. Only
// a separate PROCESS contains it. Here, the same abort kills this host alone;
// main sees an `exit` event, fails the in-flight call, and respawns on the next
// one. Atlas loses a write. The IDE does not notice.
//
// This file is a SEPARATE electron-vite entry (out/main/atlasDbHost.js) and is
// the only place that opens the database.

import type { DatabaseSync } from "node:sqlite";
import { DB_OPS, type DbRequest, type DbResponse } from "./dbOps";
import { openAtlasDb } from "./store";

// The database file arrives as argv, so the host never has to know about
// Electron's app paths -- it is a plain Node program.
const file = process.argv[2];

let db: DatabaseSync | null = null;
function handle(): DatabaseSync {
  if (db === null) {
    if (typeof file !== "string" || file.length === 0) {
      throw new Error("atlas db host started with no database path");
    }
    db = openAtlasDb(file);
  }
  return db;
}

function run(req: DbRequest): DbResponse {
  try {
    const fn = DB_OPS[req.op] as
      | ((db: DatabaseSync, ...args: unknown[]) => unknown)
      | undefined;
    // Guard the lookup rather than trusting the sender: an unknown name must be
    // a normal rejected call, never an undefined-is-not-a-function crash in the
    // one process whose whole job is to not crash the app.
    if (typeof fn !== "function") {
      return { id: req.id, ok: false, error: `unknown atlas db op: ${req.op}` };
    }
    return { id: req.id, ok: true, value: fn(handle(), ...req.args) };
  } catch (e) {
    return {
      id: req.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

process.parentPort.on("message", (e) => {
  const req = e.data as DbRequest;
  if (!req || typeof req.id !== "number") return;
  process.parentPort.postMessage(run(req));
});
