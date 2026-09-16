import {
  ATLAS_STANDING_DEFAULT,
  ATLAS_STANDING_FADE_AT,
  ATLAS_STANDING_MAX,
  ATLAS_STANDING_MIN,
} from "../../../shared/ipc";

// Pure geometry for the Atlas "Still open" splitter. No DOM/IPC -- the panel
// measures the three bounds and feeds them in with the drag delta, and gets
// back the clamped height.

// Re-exported under the renderer's shorter path; the values live in
// shared/ipc.ts so main's prefs sanitiser clamps to the SAME interval this
// handle can produce.
export {
  ATLAS_STANDING_DEFAULT,
  ATLAS_STANDING_FADE_AT,
  ATLAS_STANDING_MAX,
  ATLAS_STANDING_MIN,
};

// Pixels of the debrief the concern list may never take. The section used to
// push the debrief off the top entirely; a drag must not be a new way to do it.
export const ATLAS_BRIEF_FLOOR = 80;

export interface StandingBounds {
  // The first concern row's measured height. The floor is one WHOLE row, so a
  // row that wrapped to two lines raises it.
  rowHeight: number;
  // The list's full scroll height. Growing past it would only add dead space.
  contentHeight: number;
  // What the panel can spare without burying the debrief, which is the one
  // thing the panel exists to show.
  available: number;
}

// How tall the list may become inside a panel of `panelHeight`, where
// `chromeHeight` is what the section spends above the list (the divider and the
// STILL OPEN header). The list may take the whole panel except the debrief's
// floor and its own header -- which is the bound that matters, because the
// surface that actually squeezes is the dropdown, where the brief is the flex
// child that gives way.
//
// 0 means "could not be measured", which resizeStanding reads as no ceiling at
// all. That is also the right answer for a panel too short for its own chrome:
// there is nothing to compute a ceiling from, so the one-row floor governs.
export function availableFor(
  panelHeight: number,
  chromeHeight: number,
): number {
  if (!Number.isFinite(panelHeight) || !Number.isFinite(chromeHeight)) return 0;
  return Math.max(
    0,
    Math.round(panelHeight - ATLAS_BRIEF_FLOOR - chromeHeight),
  );
}

// Given the height at drag-start and the vertical mouse delta, return the next
// height. The handle is the section's TOP edge, so dragging UP (a negative
// delta) grows it.
export function resizeStanding(
  startHeight: number,
  deltaY: number,
  bounds: StandingBounds,
): number {
  const delta = Number.isFinite(deltaY) ? deltaY : 0;
  const min = floorFor(bounds.rowHeight);
  // A ceiling below the floor is incoherent -- honour the floor, because a box
  // too short for one concern is worse than one slightly taller than its room.
  const max = Math.max(
    min,
    Math.min(cap(bounds.contentHeight), cap(bounds.available)),
  );
  return Math.min(max, Math.max(min, Math.round(startHeight - delta)));
}

// A row measures 0 in jsdom and while display:none, and a sub-floor row is a
// measurement failure rather than a real row; either way the constant wins.
function floorFor(rowHeight: number): number {
  if (!Number.isFinite(rowHeight)) return ATLAS_STANDING_MIN;
  return Math.max(ATLAS_STANDING_MIN, Math.round(rowHeight));
}

// A bound of 0 (or less) is an UNMEASURED bound, not a real ceiling: jsdom, a
// display:none section and a detached node all report it. Reading it as real
// would clamp every drag to the floor, so the handle would look wired up and do
// nothing but collapse the list. Unmeasured falls back to the absolute cap.
function cap(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return ATLAS_STANDING_MAX;
  return Math.min(ATLAS_STANDING_MAX, n);
}
