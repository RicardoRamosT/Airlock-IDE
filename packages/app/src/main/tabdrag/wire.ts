// packages/app/src/main/tabdrag/wire.ts
// Tab-drag lifecycle: track the cursor while a project tab is dragged, tell the
// windows what releasing would do, and perform the move on release.
//
// The cursor poll runs ONLY during a drag, and the hover broadcast is
// edge-triggered (sent only when the resolved target changes), so holding still
// is silent instead of a 60/s IPC storm.
//
// ASCII-only comments (CJS-bundled into Electron main).
import { BrowserWindow, screen } from "electron";
import type { DropTarget, MovingTab, TabDragHover } from "../../shared/ipc";
import { createWindowForAdopt, windowBoxesFrontMostFirst } from "../window";
import type { MovingSessions } from "./moving";
import { resolveDropTarget, sameTarget } from "./target";

const POLL_MS = 16; // ~60Hz, only while a drag is in flight

let timer: ReturnType<typeof setInterval> | null = null;
let dragSourceId: number | null = null;
let lastTarget: DropTarget | null = null;
// Name of the tab in flight, echoed in every hover so a window can say WHICH
// project it is about to take ("Release to open Airlock in a new window").
let dragLabel: string | null = null;

// Tabs waiting for a freshly created window to come up and claim them. PULLED by
// the renderer once it has mounted, never pushed: did-finish-load fires before
// React's effects run, so a pushed payload could land with nothing subscribed and
// the tab would vanish (the source window has already let it go).
const pendingAdopts = new Map<number, MovingTab>();

// Windows created to receive a torn-off tab. Their renderer must NOT run session
// restore -- the snapshot is app-global, so restoring would reopen EVERY project
// in a window that should hold only the dragged one.
const suppressRestore = new Set<number>();

export function registerAdoptWindow(
  windowId: number,
  payload: MovingTab,
): void {
  pendingAdopts.set(windowId, payload);
  suppressRestore.add(windowId);
}

// Single-use: the tab is handed over exactly once.
export function takePendingAdopt(windowId: number): MovingTab | null {
  const payload = pendingAdopts.get(windowId) ?? null;
  pendingAdopts.delete(windowId);
  return payload;
}

// Single-use: only the BOOT restore is suppressed. A later reload of that window
// behaves like any other.
export function consumeSuppressRestore(windowId: number): boolean {
  return suppressRestore.delete(windowId);
}

// A window that closed before claiming its tab keeps nothing alive.
export function forgetWindow(windowId: number): void {
  pendingAdopts.delete(windowId);
  suppressRestore.delete(windowId);
}

function broadcast(h: TabDragHover): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.webContents.isDestroyed()) w.webContents.send("tabdrag:hover", h);
  }
}

function currentTarget(sourceWindowId: number): DropTarget {
  return resolveDropTarget(
    screen.getCursorScreenPoint(),
    windowBoxesFrontMostFirst(),
    sourceWindowId,
  );
}

function stop(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  dragSourceId = null;
  lastTarget = null;
  dragLabel = null;
}

export function startTabDrag(
  sourceWindowId: number,
  label: string | null,
): void {
  stop(); // a new drag supersedes any stale one
  dragSourceId = sourceWindowId;
  dragLabel = label;
  timer = setInterval(() => {
    if (dragSourceId === null) {
      stop();
      return;
    }
    const src = BrowserWindow.fromId(dragSourceId);
    // Source window vanished mid-drag: end the drag rather than leak the timer.
    if (!src || src.isDestroyed()) {
      stop();
      return;
    }
    const target = currentTarget(dragSourceId);
    if (lastTarget && sameTarget(lastTarget, target)) return;
    lastTarget = target;
    broadcast({ target, sourceWindowId: dragSourceId, label: dragLabel });
  }, POLL_MS);
}

// Called when a window closes, so a drag started there cannot leave the poll
// running forever.
export function stopTabDragFor(windowId: number): void {
  if (dragSourceId === windowId) stop();
}

// Resolve the drop and perform it. `payload` is null when the renderer decided the
// tab cannot move (a split pair, a page-tab, or the window's last tab); this then
// only reports the target and moves nothing.
export function endTabDrag(
  sourceWindowId: number,
  payload: MovingTab | null,
  moving: MovingSessions,
): DropTarget {
  const target = currentTarget(sourceWindowId);
  stop();
  // Tell every window the drag is over so drop indicators clear.
  broadcast({ target: { kind: "reorder" }, sourceWindowId, label: null });
  if (!payload || target.kind === "reorder") return { kind: "reorder" };

  // Ticket the live ptys so (and only so) the adopting window may re-point them.
  moving.mark(payload.terminals.map((t) => t.ptyId));

  if (target.kind === "merge") {
    const win = BrowserWindow.fromId(target.windowId);
    if (win && !win.isDestroyed()) {
      win.webContents.send("tabdrag:adopt", payload);
      win.focus();
      return target;
    }
    // Target closed between the last hover and the release: fall through and
    // detach instead of losing the tab.
  }
  createWindowForAdopt(payload);
  return { kind: "detach" };
}
