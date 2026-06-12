import type { SessionUsage } from "../../../shared/ipc";

export interface ModelAggregate {
  model: string;
  sessions: number;
  costUsd: number;
  apiMs: number;
}

// How recently a session must have made progress to count as "active"/"live".
// Mirrors the statusLine refreshInterval (5s) plus jitter slack.
const ACTIVE_WITHIN_S = 20;

// Group sessions by model and sum the CUMULATIVE metrics only -- contextTokens
// is point-in-time occupancy and summing it is meaningless. A session is
// COUNTED under every model it used (modelsSeen), but its single cumulative
// cost/API can't be split per model, so those book to the session's PRIMARY
// (latest) model -- a model that only ever appeared mid-session shows the
// session count with a 0 (approximate) cost. Sorted by API time, the "which
// model worked more" ordering that still ranks on subscription plans where
// reported USD is zero.
export function aggregateByModel(sessions: SessionUsage[]): ModelAggregate[] {
  const byModel = new Map<string, ModelAggregate>();
  const ensure = (model: string): ModelAggregate => {
    let agg = byModel.get(model);
    if (!agg) {
      agg = { model, sessions: 0, costUsd: 0, apiMs: 0 };
      byModel.set(model, agg);
    }
    return agg;
  };
  for (const s of sessions) {
    const seen =
      s.modelsSeen.length > 0 ? s.modelsSeen : [s.model ?? "unknown"];
    for (const m of new Set(seen)) ensure(m).sessions += 1;
    // Cumulative totals attach to the primary (latest) model only.
    const primary = ensure(s.model ?? "unknown");
    primary.costUsd += s.costUsd;
    primary.apiMs += s.apiMs;
  }
  return [...byModel.values()].sort((a, b) => b.apiMs - a.apiMs);
}

// Did this session actually do billable/edit WORK (vs. merely load context or
// re-emit a refresh-timer snapshot)? contextTokens is point-in-time occupancy,
// NOT work -- a forked/background session can sit on a big context having done
// nothing, so it is excluded.
export function sessionDidWork(s: SessionUsage): boolean {
  return s.apiMs > 0 || s.costUsd > 0 || s.linesAdded > 0 || s.linesRemoved > 0;
}

// The sessions worth listing: those that did real work. Drops the all-zero
// pre-first-response blanks AND the context-only ghosts (a home-dir fork that
// loaded context but never completed a turn).
export function visibleSessions(sessions: SessionUsage[]): SessionUsage[] {
  return sessions.filter(sessionDidWork);
}

// "Active" means the session's usage ADVANCED recently -- not that it merely
// re-emitted on its refresh timer. An open-but-idle (or forked/background)
// session keeps emitting unchanged numbers; keying off lastProgressAt (set
// only when a work metric climbed) makes it correctly read idle.
export function isSessionActive(
  s: SessionUsage,
  now: number,
  withinS = ACTIVE_WITHIN_S,
): boolean {
  return now - s.lastProgressAt <= withinS;
}

// Every model a session used, for its Sessions-table row. Multiple when the
// session switched models mid-run.
export function formatModels(s: SessionUsage): string {
  return s.modelsSeen.length > 0
    ? s.modelsSeen.join(", ")
    : (s.model ?? "unknown");
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatApiTime(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function formatUsd(n: number): string {
  if (n <= 0) return "—";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}
