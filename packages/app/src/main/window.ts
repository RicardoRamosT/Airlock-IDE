// Per-window workspace state + the window factory. Each airlock window has its
// own open folder (workspaceRoots, keyed by BrowserWindow id). The MCP agent
// resolves to the LAST-FOCUSED window's root (the window you last used), which
// survives alt-tabbing away from airlock. ASCII-only: CJS-bundled into Electron
// main.
import path from "node:path";
import { BrowserWindow, type WebContents } from "electron";

const workspaceRoots = new Map<number, string>(); // BrowserWindow.id -> open folder
let lastFocusedId: number | null = null;

function winIdForSender(sender: WebContents): number | null {
  return BrowserWindow.fromWebContents(sender)?.id ?? null;
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
}

export function clearRootForEvent(e: { sender: WebContents }): void {
  const id = winIdForSender(e.sender);
  if (id !== null) workspaceRoots.delete(id);
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

// New Window opens a fresh, no-folder airlock window.
export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#0d1117",
    title: "airlock",
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
  win.on("closed", () => {
    workspaceRoots.delete(win.id);
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
