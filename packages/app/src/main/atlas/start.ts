// ASCII comments only. Atlas's startup wiring: the ARRIVAL trigger.
//
// This file exists because its absence was a real bug. maybeCompose and its
// seven tests shipped with nothing calling it, so the debrief could never
// compose -- green tests over a dead feature, found only by clicking. The
// listener below is the whole point of the "on arrival, not on a clock"
// design, so it must never be implicit again.

import { app, powerMonitor } from "electron";
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
        earliestHour: () => prefs.atlas.hour,
        onBriefReady: () => setUnread(true),
      });
      if (composed) setUnread(true);
    })();
  };

  // ARRIVAL means "the user showed up today", not "AirLock was launched".
  // AirLock is typically left running for days, so launch is far too rare a
  // signal -- someone who never quits it would never get a debrief. What
  // actually marks a new day starting is the machine waking up and the person
  // sitting down.
  //
  // maybeCompose is idempotent per calendar day and guards its own in-flight
  // state, so every one of these is safe to fire repeatedly: once today's
  // brief exists they all return immediately.
  app.on("browser-window-focus", onArrival); // sat down at the app
  powerMonitor.on("resume", onArrival); // Mac woke from sleep
  powerMonitor.on("unlock-screen", onArrival); // unlocked the screen
  app.on("activate", onArrival); // clicked the dock icon
  onArrival(); // launched

  // Backstop for a machine that never sleeps and an app that keeps focus
  // across midnight: without this the day could roll over with no signal at
  // all. Cheap -- it is a day-key comparison, and composes at most once a day.
  setInterval(onArrival, 15 * 60 * 1000).unref();
}
