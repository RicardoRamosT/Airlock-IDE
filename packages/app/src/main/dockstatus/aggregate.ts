// packages/app/src/main/dockstatus/aggregate.ts
// Pure aggregation of per-session Claude activity into one dock-icon state.
// Fed by hook-driven side-channel files; no I/O here.

export type DockState = "working" | "done" | "idle";
export interface SessionEntry {
  state: "working" | "done";
  ts: number; // epoch seconds of the emitting hook
}

// A `working` older than this (with no `Stop`) is treated as no-longer-working.
// The only case that leaves a dangling `working` is an Esc-interrupt (Claude
// Code does not fire `Stop` on interrupt); the session's next prompt or
// SessionEnd re-syncs sooner in practice, so this is just a last-resort net.
export const WORKING_STALE_SECONDS = 900;

// Parse one side-channel line "<state> <epoch>" -> entry, or null if malformed.
export function parseSessionLine(line: string): SessionEntry | null {
  const m = line.trim().match(/^(working|done) (\d+)$/);
  if (!m) return null;
  const state = m[1];
  const ts = m[2];
  if ((state !== "working" && state !== "done") || ts === undefined)
    return null;
  return { state, ts: Number(ts) };
}

// Fold all sessions into the app-wide dock state.
// - any session working within the staleness horizon -> "working" (wins)
// - else any session done with ts > ackAt (unacknowledged since last focus) -> "done"
// - else "idle"
export function aggregateDockState(
  sessions: Iterable<SessionEntry>,
  ackAt: number,
  now: number,
): DockState {
  let done = false;
  for (const s of sessions) {
    if (s.state === "working" && s.ts > now - WORKING_STALE_SECONDS) {
      return "working";
    }
    if (s.state === "done" && s.ts > ackAt) done = true;
  }
  return done ? "done" : "idle";
}
