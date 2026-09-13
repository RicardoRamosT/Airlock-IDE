// ASCII comments only. The arrival cycle: refresh the portfolio (free), decide
// whether a brief is due, compose it (one Sonnet call), store it, and say so.
//
// A single in-flight guard lives here rather than in the trigger, because
// window focus fires many times a second while the user switches applications
// and a compose takes seconds.

import {
  buildBriefPrompt,
  type CollectDeps,
  type DebriefWindow,
  debriefWindow,
  renderStillOpen,
  shouldCompose,
} from "@airlock/agent-core";
import { runComposer, type SpawnFn } from "./composer";
import type { AtlasDb } from "./dbOps";
import { refreshPortfolio } from "./refresh";
import type { StandupResult } from "./standup";
import { dayKey } from "./store";

export interface AtlasDeps {
  db: AtlasDb;
  collect: CollectDeps;
  spawn: SpawnFn;
  now(): number;
  tzOffsetMinutes(): number;
  roots(): string[]; // open tab roots
  recents(): string[]; // AirLock's recentFolders -- the strongest seed
  enabled(): boolean;
  acknowledged(): boolean;
  earliestHour(): number;
  // Injected so wire.test.ts never spawns a CLI. Production wires this to
  // runStandup with collectLedger / readDigests / runReporters.
  standup(
    roots: readonly string[],
    window: DebriefWindow,
  ): Promise<StandupResult>;
  onBriefReady?: (day: string) => void;
}

let composing = false;

// Returns true when a brief was composed and stored.
export async function maybeCompose(deps: AtlasDeps): Promise<boolean> {
  // CLAIM THE SLOT SYNCHRONOUSLY, before the first await.
  //
  // A lid-open fires browser-window-focus, powerMonitor resume, unlock-screen
  // and activate at once. Reading `composing` and setting it on either side of
  // an await lets every one of them pass the check before any sets the flag --
  // several concurrent Opus composers, each billed, all writing one brief. The
  // guard was sound while the store was synchronous; the gap opened when the
  // database moved into its own process and lastBriefDay became a process hop.
  if (composing) return false;
  composing = true;
  try {
    const now = deps.now();
    const today = dayKey(now, deps.tzOffsetMinutes());
    const lastDay = await deps.db.lastBriefDay();

    if (
      !shouldCompose({
        enabled: deps.enabled(),
        acknowledged: deps.acknowledged(),
        lastBriefDay: lastDay,
        today,
        // We already hold the claim, so from this caller's view nothing else
        // is composing. The flag above is the real mutual exclusion.
        composing: false,
        localHour: new Date(
          now + deps.tzOffsetMinutes() * 60_000,
        ).getUTCHours(),
        earliestHour: deps.earliestHour(),
      })
    ) {
      return false;
    }

    // Since the LAST BRIEF, not a fixed 24 hours: a skipped day used to fall
    // out of every debrief permanently.
    const window = debriefWindow(await deps.db.lastBriefAt(), now);
    const snaps = await refreshPortfolio({
      db: deps.db,
      deps: deps.collect,
      recentFolders: deps.recents(),
      openTabRoots: deps.roots(),
      now,
      tzOffsetMinutes: deps.tzOffsetMinutes(),
      sinceMs: window.sinceMs,
    });

    // Every project that saw work files a report. A compose that failed and is
    // retried must not re-spend the reporters, so a stored standup for today is
    // reused rather than re-run.
    const stored = await deps.db.readReports(today);
    const standup =
      stored ??
      (await deps.standup(
        snaps.map((s) => s.root),
        window,
      ));
    if (!stored)
      await deps.db.saveReports(
        today,
        standup.reports,
        standup.ledgers,
        standup.quiet,
      );

    // Open concerns ride the PROMPT as read-only context, so the model can
    // reference one in TODAY when it bears on the day's work. It is told not to
    // restate the list: the panel renders that itself, live from the table.
    const standing = renderStillOpen(await deps.db.readConcerns(), now);
    const prompt = buildBriefPrompt(
      standup.ledgers,
      standup.reports,
      standup.quiet,
      window,
      now,
    );
    const result = await runComposer(
      deps.spawn,
      standing
        ? `${prompt}\n\n${standing}\n(These are already shown to the user separately. Do not list them again; mention one only if it bears on today.)`
        : prompt,
    );
    // A failed compose stores nothing, so the day is not consumed and the next
    // arrival tries again.
    if (result === null) return false;

    await deps.db.saveBrief({
      day: today,
      text: result.text,
      costUsd: result.costUsd,
      createdAt: now,
    });
    deps.onBriefReady?.(today);
    return true;
  } finally {
    composing = false;
  }
}
