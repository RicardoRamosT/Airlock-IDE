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

// What a release actually DOES with the tab, once the cursor's target is known.
//
// `canDetach` is false for the source window's LAST tab: that window is already
// this project's own window, so handing the tab to a NEW one would swap one
// window for another and leave the source empty. It does NOT mean the tab is
// stuck -- MERGING it is a real move, and the only way to put a torn-off window
// back. Conflating the two is what made a torn-off window unmergeable: the drop
// resolved a merge target, then moved nothing.
//
// `canAdopt` is false when the merge target died between the last hover and the
// release (or was never an app window that listens for "tabdrag:adopt"). That
// falls back to a new window rather than losing the tab -- unless the source
// cannot spare it, in which case the tab simply stays put.
export type DropAction = "none" | "merge" | "detach";

export function dropAction(
  target: DropTarget,
  ctx: { hasPayload: boolean; canAdopt: boolean; canDetach: boolean },
): DropAction {
  if (!ctx.hasPayload || target.kind === "reorder") return "none";
  if (target.kind === "merge" && ctx.canAdopt) return "merge";
  return ctx.canDetach ? "detach" : "none";
}

// The target to ADVERTISE while the drag is in flight. The hint has to promise
// only what the release will actually do, so a tab that cannot detach is never
// offered a new window -- that is the same lie the unmergeable last tab told,
// just on the other side of the rule. A merge is still offered: a last tab can
// do that, and it is how a torn-off window is put back.
export function hoverTarget(
  target: DropTarget,
  canDetach: boolean,
): DropTarget {
  return target.kind === "detach" && !canDetach ? { kind: "reorder" } : target;
}
