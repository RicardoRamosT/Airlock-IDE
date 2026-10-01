// packages/app/src/renderer/src/lib/terminalRepaint.ts
// Make the program in a pty repaint its whole screen.
//
// Needed when a terminal ADOPTS a live pty (project-tab tear-off / merge): the
// new xterm rebuilds its screen from a raw byte tail, which cannot reproduce a
// TUI's screen -- the tail starts mid-frame, and was emitted against a screen
// (and often a size) the fresh xterm never had. Claude Code redraws by diffing
// against what it BELIEVES is on screen, so it only rewrites the cells it
// thinks changed and the rest stay wrong: its composer's rules and half its
// footer simply vanished after a drag out and back in. Only the program itself
// can repaint, and SIGWINCH is the one request every TUI honours.
//
// The kernel sends SIGWINCH only when the size CHANGES, and Node emits 'resize'
// only when the size it reads differs from the last one -- so a same-size
// resize does nothing, and so do two resizes in a row (the second lands before
// the program reads the first, it reads the final size, and nothing changed).
// Both verified with node-pty on macOS. Hence a real change, SPACED: one column
// narrower, then back. Width rather than height because a narrower screen forces
// a full re-layout, where a height change may only move the bottom edge.

/** Delay between the nudge and the restore; 50ms was enough in the probe. */
export const REPAINT_NUDGE_MS = 120;

/**
 * Resize to one column narrower, then back after REPAINT_NUDGE_MS. `size` is
 * read at EACH step, so a refit landing in between is not undone by a stale
 * restore. Returns a disposer that cancels a pending restore -- and still
 * restores, so a pty is never left one column short of its xterm.
 */
export function forceRepaint(
  resize: (cols: number, rows: number) => void,
  size: () => { cols: number; rows: number },
): () => void {
  const restore = () => {
    const { cols, rows } = size();
    resize(cols, rows);
  };
  const { cols, rows } = size();
  if (cols < 2 || rows < 1) {
    restore();
    return () => {};
  }
  resize(cols - 1, rows);
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    timer = undefined;
    restore();
  }, REPAINT_NUDGE_MS);
  return () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    restore();
  };
}
