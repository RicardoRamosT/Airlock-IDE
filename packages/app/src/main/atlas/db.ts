// ASCII comments only. One Atlas database CLIENT for the whole main process,
// created lazily so nothing starts until Atlas is actually used.
//
// The database itself does not live here -- it lives in the separate process
// started by dbHost.ts, because a CHECK failure inside node:sqlite aborts
// whatever process it runs in and that used to be AirLock. See dbHost.ts.
//
// This file imports electron, so NO test may import it -- the same reason
// tray.ts and trayWindow.ts are split.

import path from "node:path";
import { app, utilityProcess } from "electron";
import { createDbClient } from "./dbClient";
import type { AtlasDb } from "./dbOps";

let handle: AtlasDb | null = null;

export function atlasDb(): AtlasDb {
  if (handle === null) {
    const dbFile = path.join(app.getPath("userData"), "atlas.db");
    // Built as a second electron-vite entry alongside index.js, so it sits next
    // to this bundle both in dev and inside the packaged asar.
    const hostScript = path.join(__dirname, "atlasDbHost.js");
    handle = createDbClient({
      fork: () =>
        utilityProcess.fork(hostScript, [dbFile], {
          // The host has no console to write to, and its failures already come
          // back as rejected calls.
          stdio: "ignore",
          serviceName: "atlas-db",
        }),
    });
  }
  return handle;
}
