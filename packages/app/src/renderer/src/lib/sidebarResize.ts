import {
  SIDEBAR_COLLAPSE_AT,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from "../../../shared/ipc";

// Pure geometry for the draggable sidebar splitter. No DOM/IPC -- the component
// feeds it the drag delta and gets back the clamped width (or a collapse signal).

// Re-exported under the renderer's shorter names; the values live in
// shared/ipc.ts so main's prefs sanitiser clamps to the SAME interval this
// resizer can produce.
export const SIDEBAR_DEFAULT = SIDEBAR_WIDTH_DEFAULT;
export const SIDEBAR_MIN = SIDEBAR_WIDTH_MIN;
export const SIDEBAR_MAX = SIDEBAR_WIDTH_MAX;
export { SIDEBAR_COLLAPSE_AT };

// Given the width at drag-start, the horizontal mouse delta, and which side the
// sidebar is docked, return the next width and whether to collapse. For a LEFT
// dock the divider is the sidebar's RIGHT edge (drag right = wider); for a RIGHT
// dock it is the sidebar's LEFT edge (drag left = wider).
export function resizeSidebar(
  startWidth: number,
  deltaX: number,
  dock: "left" | "right",
): { width: number; collapse: boolean } {
  const raw = dock === "left" ? startWidth + deltaX : startWidth - deltaX;
  if (raw < SIDEBAR_COLLAPSE_AT) return { width: startWidth, collapse: true };
  return {
    width: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(raw))),
    collapse: false,
  };
}
