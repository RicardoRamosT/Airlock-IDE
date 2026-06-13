// Per-window workspace state + the window factory. Each airlock window has its
// own open folder (workspaceRoots, keyed by BrowserWindow id). The MCP agent
// resolves to the LAST-FOCUSED window's root (the window you last used), which
// survives alt-tabbing away from airlock. ASCII-only: CJS-bundled into Electron
// main.
import path, { basename } from "node:path";
import { BrowserWindow, type WebContents } from "electron";
import { disposeWindowWatchers } from "./fsWatch";
import { syncLspServers } from "./lsp/client";
import {
  deleteDockController,
  getDockController,
} from "./terminal/dockRegistry";

const workspaceRoots = new Map<number, string>(); // BrowserWindow.id -> open folder
// The SET of roots the user currently has open in each window (every tab's
// root). The renderer reports it on tab changes via the workspace:roots IPC.
// resolveRoot consults it so a per-project handler's explicit root must be one
// the user actually opened in that window (defense in depth -- no arbitrary
// path). Distinct from workspaceRoots, which is the window's single FOCUSED
// root used by requireRoot / the agent.
const windowRoots = new Map<number, Set<string>>(); // BrowserWindow.id -> open tab roots
let lastFocusedId: number | null = null;

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
  win.setTitle(root ? `AirLock - ${basename(root)}` : "AirLock");
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
export function lastFocusedWindow(): BrowserWindow | null {
  if (lastFocusedId !== null) {
    const win = BrowserWindow.fromId(lastFocusedId);
    if (win && !win.isDestroyed()) return win;
  }
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  return BrowserWindow.getAllWindows()[0] ?? null;
}

// New Window opens a fresh, no-folder airlock window.
export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#0d1117",
    title: "AirLock",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Security: never allow new windows or navigation away from the app.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());

  win.on("focus", () => {
    lastFocusedId = win.id;
  });
  // A docked external terminal (Ghostty et al.) tracks this window via its
  // DockController. Hide it while the user drags/resizes AirLock -- per-call
  // osascript is too slow to follow a live drag, so hide on the first
  // move/resize tick and snap back on settle (moved/resized; Electron 42 emits
  // both on macOS). dragSettling collapses the high-frequency move/will-resize
  // stream to a single hide so we don't flood osascript with one spawn per tick.
  let dragSettling = false;
  const startDrag = () => {
    if (dragSettling) return;
    dragSettling = true;
    getDockController(win.id)?.onDragStart();
  };
  const endDrag = () => {
    dragSettling = false;
    void getDockController(win.id)?.onDragEnd();
  };
  win.on(
    "minimize",
    () => void getDockController(win.id)?.setWindowVisible(false),
  );
  win.on(
    "restore",
    () => void getDockController(win.id)?.setWindowVisible(true),
  );
  win.on("hide", () => void getDockController(win.id)?.setWindowVisible(false));
  win.on("show", () => void getDockController(win.id)?.setWindowVisible(true));
  // If 'moved'/'resized' never fires after a 'move'/'will-resize' (rare:
  // Mission Control / Stage Manager transitions, display reconfigure),
  // dragSettling stays true and the terminal stays hidden until the next
  // move/resize cycle. Self-healing on the next interaction; acceptable for v1.
  win.on("move", startDrag);
  win.on("moved", endDrag);
  win.on("will-resize", startDrag);
  win.on("resized", endDrag);
  win.on("closed", () => {
    workspaceRoots.delete(win.id);
    windowRoots.delete(win.id);
    disposeWindowWatchers(win.id);
    deleteDockController(win.id);
    syncLspServers(allOpenRoots());
    if (lastFocusedId === win.id) {
      lastFocusedId =
        BrowserWindow.getFocusedWindow()?.id ??
        BrowserWindow.getAllWindows()[0]?.id ??
        null;
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return win;
}
