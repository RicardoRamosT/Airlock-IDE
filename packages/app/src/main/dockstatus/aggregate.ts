// packages/app/src/main/dockstatus/aggregate.ts
// Pure aggregation of per-session Claude activity into one dock-icon state.
// Fed by two side-channel sources, joined by session_id in watch.ts:
//   - PHASE (hooks): what the session is doing -- "working" (UserPromptSubmit /
//     PostToolUse) or "done" (Stop / Notification), stamped with the hook's time.
//   - LIVE (statusLine): a ~5s heartbeat proving the session process is alive
//     RIGHT NOW. Crucially it keeps firing during long model thinking and while a
//     session waits on a subagent -- exactly the spans where NO hook fires and the
//     phase stamp would otherwise go stale. May be absent (null) when the quota
//     meter is off, since that is what installs the statusLine.
// No I/O here.

export type DockState = "working" | "done" | "idle";

export interface SessionEntry {
  phase: "working" | "done";
  phaseTs: number; // epoch seconds of the phase hook
  liveTs: number | null; // epoch seconds of the last statusLine heartbeat, or null
}

// Fallback horizon, used ONLY for a session with no liveness heartbeat (i.e. the
// quota meter is off, so no statusLine runs): a "working" not re-stamped by a tool
// call within this window is treated as no-longer-working. This is the legacy
// hook-only behavior and is kept so quota-off users are no worse off than before.
export const WORKING_STALE_SECONDS = 45;

// Liveness horizon, used when a heartbeat IS present. The statusLine re-runs every
// ~5s while a session is alive (thinking and subagent waits included), so a
// heartbeat older than this means the session is gone (turn ended, Esc-interrupt,
// or crash) -> clear it. 3x the 5s refresh to tolerate jitter; matches the quota
// meter's own STALE_AFTER_SECONDS.
export const LIVENESS_STALE_SECONDS = 15;

// One parsed PHASE side-channel line "<state> <epoch>".
export interface PhaseLine {
  state: "working" | "done";
  ts: number;
}

// Parse one PHASE line "<state> <epoch>" -> entry, or null if malformed.
export function parseSessionLine(line: string): PhaseLine | null {
  const m = line.trim().match(/^(working|done) (\d+)$/);
  if (!m) return null;
  const state = m[1];
  const ts = m[2];
  if ((state !== "working" && state !== "done") || ts === undefined)
    return null;
  return { state, ts: Number(ts) };
}

// Parse one LIVE line "<epoch>" -> seconds, or null if malformed / non-positive.
export function parseLivenessLine(line: string): number | null {
  const t = line.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// A session is actively working iff its phase is "working" AND it is still alive:
//   - heartbeat present -> alive = heartbeat within LIVENESS_STALE_SECONDS
//   - heartbeat absent  -> alive = phase stamp within WORKING_STALE_SECONDS (legacy)
// The phase gate is what keeps an idle-but-open session (which still pings the
// statusLine) from showing yellow: once Stop flips it to "done", pings no longer
// count as work.
function isWorking(s: SessionEntry, now: number): boolean {
  if (s.phase !== "working") return false;
  return s.liveTs !== null
    ? s.liveTs > now - LIVENESS_STALE_SECONDS
    : s.phaseTs > now - WORKING_STALE_SECONDS;
}

// Fold all sessions into the app-wide dock state.
// - ANY session working (per isWorking) -> "working" (wins). Across several
//   concurrent Claudes this keeps the dot yellow until EVERY session has finished.
// - else any session done with phaseTs > ackAt (unacknowledged since last focus) -> "done"
// - else "idle"
export function aggregateDockState(
  sessions: Iterable<SessionEntry>,
  ackAt: number,
  now: number,
): DockState {
  let done = false;
  for (const s of sessions) {
    if (isWorking(s, now)) return "working";
    if (s.phase === "done" && s.phaseTs > ackAt) done = true;
  }
  return done ? "done" : "idle";
}
