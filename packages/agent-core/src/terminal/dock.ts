// Pure helpers for docking an external terminal window into AirLock's pane.
// No I/O: geometry math, a show/hide decision, and osascript text builders.
// ASCII-only comments (CJS-bundled into the Electron main process).
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface DomRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// The docked window's screen rectangle = the window's content origin (screen
// points, from Electron getContentBounds) plus the pane's DOM rect (CSS px =
// points). All top-left origin, so this composes across monitors. Rounded to
// whole points for crisp window placement.
export function paneScreenRect(content: ScreenRect, dom: DomRect): ScreenRect {
  return {
    x: Math.round(content.x + dom.left),
    y: Math.round(content.y + dom.top),
    width: Math.round(dom.width),
    height: Math.round(dom.height),
  };
}

export interface DockState {
  paneShown: boolean; // the terminal pane is the shown main view
  windowVisible: boolean; // AirLock not minimized/hidden
  overlayActive: boolean; // an AirLock overlay covers the pane
  dragging: boolean; // AirLock is mid move/resize
}

// Show the docked window only when the pane is shown, the window is visible, no
// overlay covers the pane, and we are not mid-drag (per-call osascript is too
// slow to track a live drag, so we hide then snap on settle).
export function dockVisibility(s: DockState): "show" | "hide" {
  return s.paneShown && s.windowVisible && !s.overlayActive && !s.dragging
    ? "show"
    : "hide";
}

// Far off-screen point used to "hide" a docked window (reversible: snap back by
// re-applying setFrameScript). Avoids minimize/visible-toggle animations.
const OFFSCREEN = -32000;

// AppleScript to move+resize window 1 of an Accessibility process. Numeric
// coords + a first-party process name only -- no untrusted interpolation.
export function setFrameScript(axProcess: string, r: ScreenRect): string {
  return [
    `tell application "System Events" to tell process "${axProcess}"`,
    `set position of window 1 to {${r.x}, ${r.y}}`,
    `set size of window 1 to {${r.width}, ${r.height}}`,
    `end tell`,
  ].join("\n");
}

export function hideWindowScript(axProcess: string): string {
  return `tell application "System Events" to tell process "${axProcess}" to set position of window 1 to {${OFFSCREEN}, ${OFFSCREEN}}`;
}
