// packages/app/src/main/tabdrag/cursorHint.ts
// A small always-on-top label that follows the cursor while a project tab is being
// dragged OUTSIDE every AirLock window. The in-strip hint is useless there -- you
// are looking at the cursor, out over the desktop or another app -- so the message
// has to travel with it.
//
// It is a frameless, transparent, NON-FOCUSABLE window that ignores mouse events.
// All three matter: taking focus or swallowing the pointer would cancel the HTML5
// drag still in flight in the source window, and a cancelled drag mid-move is how
// you lose a tab.
//
// ASCII-only comments (CJS-bundled into Electron main).
import { BrowserWindow, screen } from "electron";
import { restoreDockTile } from "../dockstatus/watch";

// Generous fixed size: the window is transparent, so only the chip inside is
// visible and the text never needs measuring in main.
const W = 420;
const H = 34;
// Offset so the label sits below-right of the pointer instead of under it.
const DX = 16;
const DY = 20;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Keep the whole label on the display it is being shown on: near the right or
// bottom edge it flips to the other side of the cursor rather than running off.
export function hintBounds(
  point: { x: number; y: number },
  area: Rect,
  size: { width: number; height: number } = { width: W, height: H },
): Rect {
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  let x = point.x + DX;
  let y = point.y + DY;
  if (x + size.width > right) x = point.x - DX - size.width;
  if (y + size.height > bottom) y = point.y - DY - size.height;
  // Still clamp, in case flipping alone cannot fit it (tiny display).
  x = Math.max(area.x, Math.min(x, right - size.width));
  y = Math.max(area.y, Math.min(y, bottom - size.height));
  return { x: Math.round(x), y: Math.round(y), ...size };
}

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// The label's markup. Text is escaped: a project name is a folder name and can
// contain anything.
export function hintHtml(text: string): string {
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent;overflow:hidden;
      -webkit-user-select:none;user-select:none;cursor:default}
    .chip{display:inline-flex;align-items:center;gap:6px;margin:6px;
      padding:0 12px;height:22px;border-radius:999px;
      background:#11161d;border:1px solid #58a6ff;color:#c9d1d9;
      font:500 11px/1 -apple-system,"SF Pro Text",system-ui,sans-serif;
      white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.5)}
    .chip b{color:#e8eef6;font-weight:600}
  </style><div class="chip">&#8599; ${escapeHtml(text)}</div>`;
}

let hint: BrowserWindow | null = null;
let shownText = "";

// The label is a real BrowserWindow, so it shows up in BrowserWindow.getAllWindows()
// like any other -- and the tab-drop hit test walks exactly that list. Left in, the
// hint would become a DROP TARGET: near a screen edge the cursor can end up inside
// its bounds and the drag would resolve to "merge into the tooltip". Callers that
// treat windows as app windows must skip it.
export function isCursorHintWindow(id: number): boolean {
  return hint !== null && !hint.isDestroyed() && hint.id === id;
}

// Show (creating on first use) and move the label to the cursor. Called on every
// poll tick while the drop target is "detach".
export function showCursorHint(
  text: string,
  point: { x: number; y: number },
): void {
  const area = screen.getDisplayNearestPoint(point).workArea;
  const bounds = hintBounds(point, area);
  if (hint && !hint.isDestroyed()) {
    if (text !== shownText) {
      shownText = text;
      void hint.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(hintHtml(text))}`,
      );
    }
    hint.setBounds(bounds);
    return;
  }
  shownText = text;
  hint = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // The three that keep the in-flight drag alive.
    focusable: false,
    show: false,
    acceptFirstMouse: false,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  // Never a drop target, never a click target: the cursor passes straight through.
  hint.setIgnoreMouseEvents(true);
  // Above other applications too -- the user is dragging over the desktop.
  hint.setAlwaysOnTop(true, "screen-saver");
  hint.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // ...which is the call that makes macOS drop AirLock's dock tile (badge and
  // running-app dot both), so put it straight back. Verified not to disturb the
  // in-flight drag: the label keeps all-workspaces + always-on-top and stays
  // unfocused across dock.show().
  restoreDockTile();
  void hint.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(hintHtml(text))}`,
  );
  // showInactive, never show(): show() would focus it and kill the drag.
  hint.showInactive();
}

// Must be called on EVERY drag-exit path, or a stray label floats forever.
export function hideCursorHint(): void {
  if (hint && !hint.isDestroyed()) hint.destroy();
  hint = null;
  shownText = "";
}
