// Pure geometry for the draggable sidebar splitter. No DOM/IPC -- the component
// feeds it the drag delta and gets back the clamped width (or a collapse signal).

export const SIDEBAR_DEFAULT = 230; // matches the original fixed column width
export const SIDEBAR_MIN = 160;
export const SIDEBAR_MAX = 600;
// Drag the divider so the sidebar would be narrower than this -> collapse (hide)
// it instead of clamping to MIN, so the handle doubles as a collapse gesture.
export const SIDEBAR_COLLAPSE_AT = 120;

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
