// ASCII comments only. The arrival cycle: refresh the portfolio (free), decide
// whether a brief is due, compose it (one Sonnet call), store it, and say so.
//
// A single in-flight guard lives here rather than in the trigger, because
// window focus fires many times a second while the user switches applications
// and a compose takes seconds.

import type { DatabaseSync } from "node:sqlite";
import {
  buildBriefPrompt,
  type CollectDeps,
  shouldCompose,
} from "@airlock/agent-core";
import { runComposer, type SpawnFn } from "./composer";
import { refreshPortfolio } from "./refresh";
import { dayKey, lastBriefDay, saveBrief } from "./store";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface AtlasDeps {
  db: DatabaseSync;
  collect: CollectDeps;
  spawn: SpawnFn;
  now(): number;
  tzOffsetMinutes(): number;
  roots(): string[]; // open tab roots
  recents(): string[]; // AirLock's recentFolders -- the strongest seed
  enabled(): boolean;
  acknowledged(): boolean;
  onBriefReady(day: string): void;
}

let composing = false;

// Returns true when a brief was composed and stored.
export async function maybeCompose(deps: AtlasDeps): Promise<boolean> {
  const now = deps.now();
  const today = dayKey(now, deps.tzOffsetMinutes());

  if (
    !shouldCompose({
      enabled: deps.enabled(),
      acknowledged: deps.acknowledged(),
      lastBriefDay: lastBriefDay(deps.db),
      today,
      composing,
    })
  ) {
    return false;
  }

  composing = true;
  try {
    const sinceMs = now - WINDOW_MS;
    const snaps = await refreshPortfolio({
      db: deps.db,
      deps: deps.collect,
      recentFolders: deps.recents(),
      openTabRoots: deps.roots(),
      now,
      tzOffsetMinutes: deps.tzOffsetMinutes(),
      sinceMs,
    });

    const result = await runComposer(
      deps.spawn,
      buildBriefPrompt(snaps, sinceMs, now),
    );
    // A failed compose stores nothing, so the day is not consumed and the next
    // arrival tries again.
    if (result === null) return false;

    saveBrief(deps.db, {
      day: today,
      text: result.text,
      costUsd: result.costUsd,
      createdAt: now,
    });
    deps.onBriefReady(today);
    return true;
  } finally {
    composing = false;
  }
}
