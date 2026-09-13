// ASCII comments only. How much time a debrief covers.
//
// The old rule was a fixed 24 hours, which quietly loses a skipped day: work
// done on Saturday is never reported if the next debrief is Monday. The window
// therefore runs from the LAST DEBRIEF, not from the clock.
//
// Two guards. A floor, so a second debrief the same day still covers yesterday
// rather than reporting on the three hours since breakfast. And a cap, so
// returning from three weeks away does not build a prompt out of a month of
// commits -- when it fires, the debrief says so rather than truncating quietly.

export interface DebriefWindow {
  sinceMs: number;
  untilMs: number;
  capped: boolean; // the cap fired: work before sinceMs exists and is not shown
}

export const WINDOW_FLOOR_MS = 24 * 60 * 60 * 1000;
export const WINDOW_CAP_MS = 30 * 24 * 60 * 60 * 1000;

export function debriefWindow(
  lastBriefMs: number | null,
  now: number,
): DebriefWindow {
  const floor = now - WINDOW_FLOOR_MS;
  // A last brief in the FUTURE means the clock moved backwards. Treat it as no
  // brief at all rather than inverting the window.
  if (
    lastBriefMs === null ||
    !Number.isFinite(lastBriefMs) ||
    lastBriefMs > now
  )
    return { sinceMs: floor, untilMs: now, capped: false };

  const cap = now - WINDOW_CAP_MS;
  if (lastBriefMs < cap) return { sinceMs: cap, untilMs: now, capped: true };
  return { sinceMs: Math.min(lastBriefMs, floor), untilMs: now, capped: false };
}
