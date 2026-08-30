// ASCII comments only. One database handle for the whole main process. Opened
// lazily so nothing touches disk until Atlas is actually used.
//
// This file imports electron, so NO test may import it -- the same reason
// tray.ts and trayWindow.ts are split.

import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { app } from "electron";
import { openAtlasDb } from "./store";

let handle: DatabaseSync | null = null;

export function atlasDb(): DatabaseSync {
  if (handle === null) {
    handle = openAtlasDb(path.join(app.getPath("userData"), "atlas.db"));
  }
  return handle;
}
