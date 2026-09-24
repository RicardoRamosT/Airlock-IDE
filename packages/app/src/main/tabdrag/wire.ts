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
import {
  appWindows,
  createWindowForAdopt,
  isAppWindow,
  windowBoxesFrontMostFirst,
} from "../window";
import { hideCursorHint, showCursorHint } from "./cursorHint";
import type { MovingSessions } from "./moving";
import {
  dropAction,
  hoverTarget,
  resolveDropTarget,
  sameTarget,
} from "./target";

const POLL_MS = 16; // ~60Hz, only while a drag is in flight
// Backstop for a drag whose end never arrives (a `dragend` the source window
// never received, an OS-cancelled drag). Without it the poll runs for the rest
// of the session and every later mouse-exit paints the follow-the-cursor label
// with no drag behind it. Nothing depends on the poll for correctness --
// endTabDrag resolves the target and performs the move on its own -- so standing
// down early costs at most the live hint on an absurdly long drag.
const MAX_DRAG_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;
let dragSourceId: number | null = null;
let lastTarget: DropTarget | null = null;
// Name of the tab in flight, echoed in every hover so a window can say WHICH
// project it is about to take ("Release to open Airlock in a new window").
let dragLabel: string | null = null;
// False while the source window's LAST tab is in flight: it can merge into
// another window but cannot open one, so the hover hint must not offer it.
let dragCanDetach = true;

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
  // App windows only: the drag label and Atlas's windows have no listener.
  for (const w of appWindows()) {
    if (!w.webContents.isDestroyed()) w.webContents.send("tabdrag:hover", h);
  }
}

function targetAt(
  point: { x: number; y: number },
  sourceWindowId: number,
): DropTarget {
  return resolveDropTarget(point, windowBoxesFrontMostFirst(), sourceWindowId);
}

function currentTarget(sourceWindowId: number): DropTarget {
  return targetAt(screen.getCursorScreenPoint(), sourceWindowId);
}

function stop(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  dragSourceId = null;
  lastTarget = null;
  dragLabel = null;
  dragCanDetach = true;
  // Every drag-exit path funnels through here, so the label can never be orphaned.
  hideCursorHint();
}

export function startTabDrag(
  sourceWindowId: number,
  label: string | null,
  canDetach = true,
): void {
  stop(); // a new drag supersedes any stale one
  dragSourceId = sourceWindowId;
  dragLabel = label;
  dragCanDetach = canDetach;
  const startedAt = Date.now();
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
    // No end in sight: clear any drop indicator the last hover left behind, then
    // stand down (see MAX_DRAG_MS).
    if (Date.now() - startedAt > MAX_DRAG_MS) {
      broadcast({
        target: { kind: "reorder" },
        sourceWindowId: dragSourceId,
        label: null,
      });
      stop();
      return;
    }
    const point = screen.getCursorScreenPoint();
    const target = hoverTarget(targetAt(point, dragSourceId), dragCanDetach);
    // Outside every window the in-strip hint is out of sight -- the user is looking
    // at the cursor -- so the message follows the pointer instead. Repositioned on
    // EVERY tick, which is why this sits above the edge-triggered broadcast below.
    if (target.kind === "detach") {
      showCursorHint(
        `Release to open ${dragLabel ?? "this project"} in a new window`,
        point,
      );
    } else {
      hideCursorHint();
    }
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

// The window a merge would hand the tab to, or null if it cannot take it.
//
// isAppWindow as well as alive: a merge target must be able to ADOPT. Only app
// windows run the tab store that listens for "tabdrag:adopt", so sending to
// anything else drops the tab into a renderer that ignores it while the source
// still removes it -- the tab, its project and its live terminals simply vanish.
// windowBoxesFrontMostFirst already filters to app windows, so this is
// belt-and-braces for any future path that builds a merge target another way.
function adoptableWindow(windowId: number): BrowserWindow | null {
  const win = BrowserWindow.fromId(windowId);
  return win && !win.isDestroyed() && isAppWindow(win.id) ? win : null;
}

// Resolve the drop and perform it.
//
// `payload` is null when the renderer decided the tab cannot move at all (a split
// pair or a page-tab). `canDetach` is false for the window's LAST tab: it still
// ships its payload, because merging it into another window is exactly how a
// torn-off window is put back -- only opening YET another window for it is
// pointless. See dropAction, which is where the two are told apart.
export function endTabDrag(
  sourceWindowId: number,
  payload: MovingTab | null,
  moving: MovingSessions,
  canDetach = true,
): DropTarget {
  const target = currentTarget(sourceWindowId);
  stop();
  // Tell every window the drag is over so drop indicators clear.
  broadcast({ target: { kind: "reorder" }, sourceWindowId, label: null });

  const into =
    target.kind === "merge" ? adoptableWindow(target.windowId) : null;
  const action = dropAction(target, {
    hasPayload: payload !== null,
    canAdopt: into !== null,
    canDetach,
  });
  // The payload re-check is for the type checker: dropAction already answered
  // "none" for a null one.
  if (action === "none" || !payload) return { kind: "reorder" };

  // Ticket the live ptys so (and only so) the adopting window may re-point them.
  // Only once the move is settled: an outcome that moves nothing must not leave
  // single-use tickets lying around for a later adopt to spend.
  moving.mark(payload.terminals.map((t) => t.ptyId));

  if (action === "merge" && into) {
    into.webContents.send("tabdrag:adopt", payload);
    into.focus();
    return target;
  }
  createWindowForAdopt(payload);
  return { kind: "detach" };
}
