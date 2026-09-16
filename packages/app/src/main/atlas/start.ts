// ASCII comments only. Atlas's startup wiring: the ARRIVAL trigger.
//
// This file exists because its absence was a real bug. maybeCompose and its
// seven tests shipped with nothing calling it, so the debrief could never
// compose -- green tests over a dead feature, found only by clicking. The
// listener below is the whole point of the "on arrival, not on a clock"
// design, so it must never be implicit again.

import { app, powerMonitor } from "electron";
import { emitEvent } from "../eventlog/wire";
import { ghRunnerFor } from "../github/ghRunner";
import { loadPrefs } from "../prefs";
import { allOpenRoots } from "../window";
import { collectLedger } from "./codeRunners";
import { spawnClaude } from "./composer";
import { atlasDb } from "./db";
import { runReporters } from "./reporters";
import { makeCollectDeps } from "./runners";
import { runStandup } from "./standup";
import { readDigests } from "./transcripts";
import { maybeCompose } from "./wire";

export function startAtlasArrival(prefsFile: string): void {
  const onArrival = () => {
    void (async () => {
      const prefs = await loadPrefs(prefsFile);
      await maybeCompose({
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
        // The standup: each project's ledger plus its own session memory,
        // distilled by one small reporter per project that has memory.
        standup: (roots, window) =>
          runStandup(
            {
              ledger: (root, w) =>
                collectLedger(
                  { git: makeCollectDeps(), gh: ghRunnerFor },
                  root,
                  w,
                ),
              digests: (root, w) => readDigests(root, w.sinceMs, w.untilMs),
              report: (jobs, signal) => runReporters(spawnClaude, jobs, signal),
            },
            roots,
            window,
          ),
      });
    })().catch((e: unknown) => {
      // The arrival cycle used to reject into a floating promise, so a failure
      // here was invisible. writeVerified now THROWS when a value is stored
      // short rather than letting a half-written debrief through, and a throw
      // nobody logs is the same silence in a new place.
      emitEvent({
        level: "error",
        category: "atlas",
        op: "atlas.arrival",
        outcome: "error",
        detail: { reason: e instanceof Error ? e.message : String(e) },
      });
    });
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
