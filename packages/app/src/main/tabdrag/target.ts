// packages/app/src/main/tabdrag/target.ts
// Where a dragged project tab lands, from the cursor's SCREEN position.
//
// Both windows live in one process, so a tab drag never needs a native
// cross-window drag payload: the drag is an ordinary HTML5 drag inside the source
// window and the outcome is decided here from screen coordinates. That also dodges
// the macOS quirk where dragend coordinates come back stale or zeroed once the
// pointer leaves the window.
//
// ASCII-only comments (CJS-bundled into Electron main).
import type { DropTarget } from "../../shared/ipc";

export interface WindowBox {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
}

// Half-open so two adjacent windows cannot both claim a shared edge pixel.
function contains(
  b: WindowBox["bounds"],
  p: { x: number; y: number },
): boolean {
  return (
    p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height
  );
}

// `windows` must be FRONT-MOST FIRST: Electron exposes no true z-order, so the
// caller passes most-recently-focused order and the first hit wins.
export function resolveDropTarget(
  point: { x: number; y: number } | null,
  windows: readonly WindowBox[],
  sourceWindowId: number,
): DropTarget {
  // No cursor position -> do nothing, rather than risk moving a tab somewhere the
  // user never pointed at.
  if (!point) return { kind: "reorder" };
  for (const w of windows) {
    if (!contains(w.bounds, point)) continue;
    return w.id === sourceWindowId
      ? { kind: "reorder" }
      : { kind: "merge", windowId: w.id };
  }
  return { kind: "detach" };
}

// Equality for the edge-triggered hover broadcast (only send on a real change).
export function sameTarget(a: DropTarget, b: DropTarget): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "merge" && b.kind === "merge"
    ? a.windowId === b.windowId
    : true;
}
