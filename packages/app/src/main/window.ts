// Per-window workspace state + the window factory. Each airlock window has its
// own open folder (workspaceRoots, keyed by BrowserWindow id). The MCP agent
// resolves to the LAST-FOCUSED window's root (the window you last used), which
// survives alt-tabbing away from airlock. ASCII-only: CJS-bundled into Electron
// main.
import path, { basename } from "node:path";
import { BrowserWindow, dialog, screen, type WebContents } from "electron";
import type { MovingTab } from "../shared/ipc";
import { syncEslint } from "./eslint/wire";
import { emitEvent } from "./eventlog/wire";
import { disposeWindowWatchers } from "./fsWatch";
import { syncLspServers } from "./lsp/client";
import type { WindowBox } from "./tabdrag/target";
import {
  forgetWindow,
  registerAdoptWindow,
  stopTabDragFor,
} from "./tabdrag/wire";

const workspaceRoots = new Map<number, string>(); // BrowserWindow.id -> open folder
// The SET of roots the user currently has open in each window (every tab's
// root). The renderer reports it on tab changes via the workspace:roots IPC.
// resolveRoot consults it so a per-project handler's explicit root must be one
// the user actually opened in that window (defense in depth -- no arbitrary
// path). Distinct from workspaceRoots, which is the window's single FOCUSED
// root used by requireRoot / the agent.
const windowRoots = new Map<number, Set<string>>(); // BrowserWindow.id -> open tab roots
let lastFocusedId: number | null = null;
// Most-recently-focused FIRST. Electron exposes no z-order, so this approximates
// "front-most" when hit-testing a tab drop against overlapping windows.
let focusOrder: number[] = [];

function winIdForSender(sender: WebContents): number | null {
  return BrowserWindow.fromWebContents(sender)?.id ?? null;
}

// Record the full set of roots open in the sender's window (from the store on
// every tab open/close). Replaces the prior set wholesale.
export function setWindowRoots(
  e: { sender: WebContents },
  roots: string[],
): void {
  const id = winIdForSender(e.sender);
  if (id !== null) windowRoots.set(id, new Set(roots));
}

// The union of roots open across ALL windows (for per-root resource lifecycle).
export function allOpenRoots(): string[] {
  const out = new Set<string>();
  for (const roots of windowRoots.values()) for (const r of roots) out.add(r);
  return [...out];
}

// Whether `root` is one of the roots the sender's window currently has open.
// Used by resolveRoot to validate a renderer-supplied explicit root.
export function isOpenRoot(e: { sender: WebContents }, root: string): boolean {
  const id = winIdForSender(e.sender);
  return id === null ? false : (windowRoots.get(id)?.has(root) ?? false);
}

// The folder open in the window that sent an IPC event (or null).
export function rootForEvent(e: { sender: WebContents }): string | null {
  const id = winIdForSender(e.sender);
  return id === null ? null : (workspaceRoots.get(id) ?? null);
}

export function setRootForEvent(
  e: { sender: WebContents },
  root: string,
): void {
  const id = winIdForSender(e.sender);
  if (id !== null) workspaceRoots.set(id, root);
  setWindowTitleFromRoot(e, root);
}

export function clearRootForEvent(e: { sender: WebContents }): void {
  const id = winIdForSender(e.sender);
  if (id !== null) workspaceRoots.delete(id);
  setWindowTitleFromRoot(e, null);
}

// The OS window title (what the dock window-list + macOS Window menu show)
// follows the window's active project; just "airlock" when no folder is open.
function setWindowTitleFromRoot(
  e: { sender: WebContents },
  root: string | null,
): void {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isDestroyed()) return;
  win.setTitle(root ? `${basename(root)} \u00b7 AirLock` : "AirLock");
}

// The agent's window id = last-focused, with focused-window / any-window fallbacks.
export function lastFocusedWindowId(): number | null {
  if (lastFocusedId !== null && workspaceRoots.has(lastFocusedId)) {
    return lastFocusedId;
  }
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && workspaceRoots.has(focused.id)) return focused.id;
  for (const id of workspaceRoots.keys()) return id;
  return lastFocusedId;
}

// The agent's root = the last-focused window's folder (with the same fallbacks).
export function lastFocusedRoot(): string | null {
  const id = lastFocusedWindowId();
  return id === null ? null : (workspaceRoots.get(id) ?? null);
}

// The last-focused BrowserWindow the IDE-control commands target. Unlike
// lastFocusedWindowId (which requires the window to have a FOLDER open, since the
// agent's status/run tools need a root), layout control applies to ANY window,
// including a blank-tab one -- so this resolves a live window by last-focused id,
// then the OS-focused window, then any open window, regardless of an open root.
// Returns null only when no airlock window exists.
// Every window createWindow() makes -- i.e. every window that hosts the IDE
// renderer and can own tabs, terminals and menu actions. Auxiliary windows are
// deliberately absent: the tab-drag cursor label, and Atlas's chat window and
// menu-bar popover.
//
// This is a REGISTRY, not a blacklist, and the difference is the whole point.
// isCursorHintWindow had to be remembered at every "pick a window" site, and it
// was applied at three of them while six others picked getAllWindows()[0]
// blind. Atlas's chat window is the case that proved the shape wrong: its close
// handler preventDefaults and hides (so a mid-answer close never loses the
// reply), which means it stays in getAllWindows() forever and those six sites
// silently started choosing an invisible window -- the dock icon stopped
// creating a window, menu actions went to a renderer with no listener, and a
// torn-off tab could be dropped into a window with no tab store at all.
const appWindowIds = new Set<number>();

export function isAppWindow(id: number): boolean {
  return appWindowIds.has(id);
}

// Live app windows, in Electron's order. Every caller that needs "a window to
// act on" must use this rather than BrowserWindow.getAllWindows().
export function appWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter(
    (w) => !w.isDestroyed() && appWindowIds.has(w.id),
  );
}

export function lastFocusedWindow(): BrowserWindow | null {
  if (lastFocusedId !== null) {
    const win = BrowserWindow.fromId(lastFocusedId);
    if (win && !win.isDestroyed()) return win;
  }
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  // App windows only: handing an IDE-control command to the drag label or to a
  // hidden Atlas window would target something with no listener.
  return appWindows()[0] ?? null;
}

// The window currently showing `root` (active-tab match first, else any window
// with it open), for routing an agent prompt to the asking project's window
// rather than GUI focus. Returns null if no window has this root open.
export function windowForRoot(root: string): BrowserWindow | null {
  for (const [id, r] of workspaceRoots) {
    if (r === root) {
      const w = BrowserWindow.fromId(id);
      if (w && !w.isDestroyed()) return w;
    }
  }
  for (const [id, set] of windowRoots) {
    if (set.has(root)) {
      const w = BrowserWindow.fromId(id);
      if (w && !w.isDestroyed()) return w;
    }
  }
  return null;
}

// New Window opens a fresh, no-folder airlock window.
// Kill every pty a window owns. lazy-require: ipc imports from this module, so
// a top-level import would be a cycle -- the same reason agent-requests is
// required lazily in the close handler.
function reapWindowPtys(windowId: number): void {
  (require("./ipc") as typeof import("./ipc")).killSessionsForWindow(windowId);
}

function liveTerminals(windowId: number): number {
  return (require("./ipc") as typeof import("./ipc")).countSessionsForWindow(
    windowId,
  );
}

// View > Reload / Force Reload. A reload kills every terminal the window owns
// (reapWindowPtys above) -- every running Claude, mid-turn -- and session
// restore brings back one terminal per project. That is far too much for one
// stray keystroke, so with live terminals it asks first. Logged either way, so
// an unexplained reset can be told apart from a menu reload in read_events
// (the 2026-11-05 resets left no trace of their trigger).
export async function reloadWindowGuarded(
  win: BrowserWindow,
  force: boolean,
): Promise<void> {
  if (win.isDestroyed()) return;
  const live = liveTerminals(win.id);
  if (live > 0) {
    const { response } = await dialog.showMessageBox(win, {
      type: "warning",
      message: "Reload this window?",
      detail: `This ends ${live} running terminal${live === 1 ? "" : "s"}, including any Claude session working in them. Projects reopen with one terminal each.`,
      buttons: ["Cancel", "Reload"],
      defaultId: 0,
      cancelId: 0,
    });
    if (response !== 1) {
      emitEvent({
        level: "info",
        category: "lifecycle",
        op: "window.reload",
        outcome: "blocked",
        detail: { force, liveTerminals: live },
      });
      return;
    }
  }
  if (win.isDestroyed()) return;
  emitEvent({
    level: "warn",
    category: "lifecycle",
    op: "window.reload",
    actor: "user",
    detail: { force, liveTerminals: live, source: "menu" },
  });
  if (force) win.webContents.reloadIgnoringCache();
  else win.webContents.reload();
}

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#0d1117",
    title: "AirLock",
    titleBarStyle: "hiddenInset",
    // Created hidden and shown on `ready-to-show` (below). With the default
    // show:true the window appears before the renderer's first frame, so the
    // compositor can latch a stale/partial frame (content collapsed to the top
    // of the window) that never repaints until a reflow -- resize or opening
    // devtools -- forces one. The DOM lays out full-height correctly; it is
    // purely a first-paint glitch. (diagnosed 2026-06-15)
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      plugins: true,
      // Keep painting while unfocused/backgrounded so webContents.capturePage()
      // (the capture_screenshot MCP tool) returns the CURRENT frame -- throttled
      // renderers return stale frames when the agent drives from a terminal.
      backgroundThrottling: false,
    },
  });

  // Show only once the renderer has painted its first frame, so the initial
  // visible frame is the fully laid-out content (see show:false above).
  win.once("ready-to-show", () => win.show());

  // Security: never allow new windows or navigation away from the app.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());

  appWindowIds.add(win.id);

  // A RELOAD and a renderer CRASH both destroy the renderer without firing
  // "closed", and the replacement cannot re-adopt the old sessions:
  // takePendingAdopt reads a zustand store the teardown just wiped, so the new
  // renderer spawns fresh ptys and the previous ones are orphaned -- still
  // running, invisible, and still reachable by the agent. Reap on both, exactly
  // as the close path does.
  //
  // Both are LOGGED with what is known about the cause: a reset that kills
  // every agent must never again be something read_events cannot explain.
  win.webContents.on("render-process-gone", (_e, details) => {
    emitEvent({
      level: "error",
      category: "lifecycle",
      op: "window.renderer-gone",
      detail: {
        reason: details.reason,
        exitCode: details.exitCode,
        liveTerminals: liveTerminals(win.id),
      },
    });
    reapWindowPtys(win.id);
  });
  win.webContents.on("did-start-navigation", (details) => {
    // The first load fires this too, harmlessly: a brand-new window owns no
    // sessions yet. Same-document navigation keeps the renderer, so it must
    // not reap.
    if (!details.isMainFrame || details.isSameDocument) return;
    const live = liveTerminals(win.id);
    if (live > 0) {
      emitEvent({
        level: "warn",
        category: "lifecycle",
        op: "window.navigate",
        detail: {
          url: details.url,
          initiator: details.initiator?.url ?? null,
          liveTerminals: live,
          visible: win.isVisible(),
          focused: win.isFocused(),
          fullScreen: win.isFullScreen(),
        },
      });
    }
    reapWindowPtys(win.id);
  });
  win.webContents.on("unresponsive", () =>
    emitEvent({
      level: "warn",
      category: "lifecycle",
      op: "window.unresponsive",
    }),
  );

  win.on("focus", () => {
    lastFocusedId = win.id;
    focusOrder = [win.id, ...focusOrder.filter((id) => id !== win.id)];
  });

  // Fullscreen SQUARES the window's corners, so the chrome that borrows the
  // window radius has to square off with it. Pushed on change, and once on
  // load so a window that comes up already fullscreen starts correct rather
  // than showing rounded chrome against a square frame until the user toggles.
  const sendFullScreen = () => {
    if (!win.webContents.isDestroyed())
      win.webContents.send("window:fullscreen", win.isFullScreen());
  };
  win.on("enter-full-screen", sendFullScreen);
  win.on("leave-full-screen", sendFullScreen);
  win.webContents.on("did-finish-load", sendFullScreen);
  win.on("closed", () => {
    appWindowIds.delete(win.id);
    workspaceRoots.delete(win.id);
    windowRoots.delete(win.id);
    focusOrder = focusOrder.filter((id) => id !== win.id);
    // Pending agent request cards must not die with the window while their
    // agents keep waiting -- hand them to a surviving window (or resolve them if
    // none survives). lazy-require: agent-requests imports windowForRoot from
    // here, so a top-level import would be a cycle.
    (
      require("./agent-requests") as typeof import("./agent-requests")
    ).rerouteRequestsFromClosedWindow(win.id);
    // Reap the shells this window owned. ptyKill lives in a React effect
    // cleanup, which Electron does NOT run when it destroys a WebContents.
    reapWindowPtys(win.id);
    // A tab drag started here must not leave the cursor poll running, and an
    // unclaimed torn-off tab must not be kept alive for a dead window.
    stopTabDragFor(win.id);
    forgetWindow(win.id);
    disposeWindowWatchers(win.id);
    syncLspServers(allOpenRoots());
    syncEslint(allOpenRoots());
    if (lastFocusedId === win.id) {
      // appWindows(), not getAllWindows(): re-seeding onto a hidden Atlas
      // window points every IDE-control command at it.
      lastFocusedId =
        BrowserWindow.getFocusedWindow()?.id ?? appWindows()[0]?.id ?? null;
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return win;
}

// Live windows as tab-drop boxes, most-recently-focused first. The first box
// containing the cursor wins (see tabdrag/target.ts). Windows never focused yet
// (e.g. one just created) sort last.
export function windowBoxesFrontMostFirst(): WindowBox[] {
  const live = new Map<number, BrowserWindow>();
  // App windows only. A drop box must be a window that can actually ADOPT a
  // tab: the drag label would swallow its own drag, and a hidden Atlas window
  // would accept the tab into a renderer with no tab store, destroying it.
  for (const w of appWindows()) {
    live.set(w.id, w);
  }
  const ordered: BrowserWindow[] = [];
  for (const id of focusOrder) {
    const w = live.get(id);
    if (w) {
      ordered.push(w);
      live.delete(id);
    }
  }
  for (const w of live.values()) ordered.push(w);
  return ordered.map((w) => ({ id: w.id, bounds: w.getBounds() }));
}

// Open a new window that adopts a torn-off tab. The payload is PARKED for the new
// window to claim once its renderer has mounted (tabdrag:takePending) rather than
// pushed on did-finish-load -- that event fires before React's effects run, so a
// push could land with nothing subscribed and the tab would be lost. Registering
// also suppresses that window's session restore, so it opens with ONLY the dragged
// project instead of reopening every project from the app-global snapshot.
// Positioned near the cursor so the window appears where it was dropped.
export function createWindowForAdopt(payload: MovingTab): BrowserWindow {
  const win = createWindow();
  registerAdoptWindow(win.id, payload);
  const { x, y } = screen.getCursorScreenPoint();
  const b = win.getBounds();
  win.setBounds({
    ...b,
    x: Math.round(x - b.width / 3),
    y: Math.max(0, y - 20),
  });
  return win;
}
