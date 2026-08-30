// ASCII comments only. Atlas's startup wiring: the ARRIVAL trigger.
//
// This file exists because its absence was a real bug. maybeCompose and its
// seven tests shipped with nothing calling it, so the debrief could never
// compose -- green tests over a dead feature, found only by clicking. The
// listener below is the whole point of the "on arrival, not on a clock"
// design, so it must never be implicit again.

import { app } from "electron";
import { loadPrefs } from "../prefs";
import { allOpenRoots } from "../window";
import { spawnClaude } from "./composer";
import { atlasDb } from "./db";
import { makeCollectDeps } from "./runners";
import { setUnread } from "./trayWindow";
import { maybeCompose } from "./wire";

export function startAtlasArrival(prefsFile: string): void {
  const onArrival = () => {
    void (async () => {
      const prefs = await loadPrefs(prefsFile);
      const composed = await maybeCompose({
        db: atlasDb(),
        collect: makeCollectDeps(),
        spawn: spawnClaude,
        now: () => Date.now(),
        tzOffsetMinutes: () => -new Date().getTimezoneOffset(),
        roots: allOpenRoots,
        recents: () => prefs.recentFolders,
        enabled: () => prefs.atlas.enabled,
        acknowledged: () => prefs.atlas.acknowledged,
        onBriefReady: () => setUnread(true),
      });
      if (composed) setUnread(true);
    })();
  };

  // Focus is the arrival signal. maybeCompose is idempotent per day and guards
  // its own in-flight state, so firing on every focus is safe and cheap: it
  // returns immediately once today's brief exists.
  app.on("browser-window-focus", onArrival);
  // Also try once at startup, for the case where the app is launched and
  // focused before this listener is attached.
  onArrival();
}
