// ASCII comments only. Electron wiring for the Atlas menu bar item. Thin and
// untested per the project convention; every rule worth testing is in tray.ts.
//
// The item uses a TEXT title over an empty image rather than an icon asset, so
// this adds no file to electron-builder's extraResources. A proper template
// icon is deliberately deferred: adding an asset changes packaging, and
// packaging problems are caught only by `npm run package`.

import path from "node:path";
import { BrowserWindow, nativeImage, screen, Tray } from "electron";
import {
  POPOVER_HEIGHT,
  POPOVER_WIDTH,
  popoverBounds,
  TRAY_ICON_DATA_URL,
} from "./tray";

let tray: Tray | null = null;
let popover: BrowserWindow | null = null;
// Last size the user chose, fed in by main from prefs, and updated when they
// drag the window. Shared with the in-app panel so the two agree.
let panelSize = { width: POPOVER_WIDTH, height: POPOVER_HEIGHT };
let onResize: ((s: { width: number; height: number }) => void) | null = null;

export function setAtlasPanelSize(s: { width: number; height: number }): void {
  panelSize = { ...s };
}

export function onAtlasPanelResize(
  cb: (s: { width: number; height: number }) => void,
): void {
  onResize = cb;
}

function buildPopover(size: { width: number; height: number }): BrowserWindow {
  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: 280,
    minHeight: 240,
    show: false,
    frame: false,
    // Resizable like any other window: the user decides how much of the
    // debrief they want to see at once.
    resizable: true,
    skipTaskbar: true,
    fullscreenable: false,
    // Transparent so the renderer can draw a rounded bubble WITH a pointer aimed
    // at the tray icon -- a square window cannot show an arrow.
    transparent: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // Reuse the single renderer entry; the hash selects the Atlas view, so no
  // second build target and no change to electron.vite.config.ts.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) win.loadURL(`${devUrl}#atlas`);
  else
    win.loadFile(path.join(__dirname, "../renderer/index.html"), {
      hash: "atlas",
    });
  // A popover closes when you click away, like every other menu bar panel.
  win.on("blur", () => {
    noteAtlasInteraction();
    win.hide();
  });
  win.on("resized", () => {
    // getSize() is number[]; noUncheckedIndexedAccess makes each element
    // possibly-undefined, so fall back rather than assert.
    const [w, h] = win.getSize();
    panelSize = { width: w ?? panelSize.width, height: h ?? panelSize.height };
    onResize?.(panelSize);
  });
  return win;
}

// Clicking the tray icon ACTIVATES the app, and so does dismissing the popover.
// app.on("activate") cannot tell that apart from a dock click, and it creates an
// IDE window when none are open -- so using Atlas from the menu bar with AirLock
// closed made an AirLock window appear. Stamping the interaction lets the
// activate handler ignore the one it just caused.
let lastAtlasInteractionAt = 0;

export function noteAtlasInteraction(): void {
  lastAtlasInteractionAt = Date.now();
}

export function atlasJustInteracted(withinMs = 1000): boolean {
  return Date.now() - lastAtlasInteractionAt < withinMs;
}

function toggle(): void {
  if (!tray) return;
  noteAtlasInteraction();
  if (!popover) popover = buildPopover(panelSize);
  if (popover.isVisible()) {
    popover.hide();
    return;
  }
  const b = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;
  const at = popoverBounds(b, display, panelSize);
  popover.setPosition(at.x, at.y, false);
  // Where the arrow must sit INSIDE the bubble to still aim at the icon. The
  // CSS cannot know: the window's x is clamped to the display, so a wide panel
  // near an edge is pushed sideways and a fixed inset points at nothing.
  popover.webContents.send("atlas:pointer", at.pointerX);
  // Re-fetch on every open. The popover used to read the brief once on mount,
  // so a debrief composed afterwards showed as "No debrief yet" forever.
  popover.webContents.send("atlas:refresh");
  popover.show();
}

let chatWin: BrowserWindow | null = null;

// Its own window, NOT an AppPage: a page would replace the workspace view and
// take the user's work away at the moment they want to talk about it.
export function openAtlasWindow(): void {
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.show();
    chatWin.focus();
    return;
  }
  chatWin = new BrowserWindow({
    width: 460,
    height: 720,
    title: "Atlas",
    backgroundColor: "#0d1117",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) chatWin.loadURL(`${devUrl}#atlas-chat`);
  else
    chatWin.loadFile(path.join(__dirname, "../renderer/index.html"), {
      hash: "atlas-chat",
    });
  // Closing MINIMIZES. The reply is produced in the main process and persisted
  // there, so a close mid-answer never loses it -- but destroying the window
  // would throw away the scroll position and force a rebuild, and reads to the
  // user as "I interrupted it". Hide instead, and reopen the same window.
  chatWin.on("close", (e) => {
    if (chatWin && !chatWin.isDestroyed()) {
      e.preventDefault();
      chatWin.hide();
    }
  });
  chatWin.on("closed", () => {
    chatWin = null;
  });
}

export function startAtlasTray(): void {
  if (tray) return;
  // The source art is 44px so it downsamples cleanly; the macOS menu bar wants
  // roughly 18pt. Without this resize it renders at its full 44pt and dwarfs
  // every other menu bar item.
  const icon = nativeImage
    .createFromDataURL(TRAY_ICON_DATA_URL)
    .resize({ width: 18, height: 18, quality: "best" });
  // Template mode is what makes it adapt to a light or dark menu bar.
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Atlas -- your project administrator");
  tray.on("click", toggle);
}

export function stopAtlasTray(): void {
  // destroy(), not close(): the close handler above hides rather than closes,
  // so a quit has to bypass it or the app would refuse to exit.
  chatWin?.destroy();
  chatWin = null;
  popover?.destroy();
  popover = null;
  tray?.destroy();
  tray = null;
}
