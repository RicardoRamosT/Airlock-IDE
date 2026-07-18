// packages/app/src/main/dockstatus/aggregate.ts
// Pure aggregation of per-session Claude activity into one dock-icon state.
// Fed by hook-driven side-channel files; no I/O here.

export type DockState = "working" | "done" | "idle";
export interface SessionEntry {
  state: "working" | "done";
  ts: number; // epoch seconds of the emitting hook
}

// A `working` not re-stamped within this window is treated as no-longer-working.
// The PostToolUse hook re-stamps `working` on every tool call, so an actively
// working session stays fresh; once activity stops (turn done, Esc-interrupt, or
// a crash where `Stop`/`SessionEnd` never fire) the dot clears to idle within
// this window. Kept comfortably above a typical no-tool gap (model thinking /
// one long command) so a live turn does not flicker to idle mid-work. The watcher
// re-checks on a ~10s timer, so the dot clears to grey ~this window + one tick
// after a session goes quiet.
export const WORKING_STALE_SECONDS = 45;

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
