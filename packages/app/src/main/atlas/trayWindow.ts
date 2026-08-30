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
  trayTitle,
} from "./tray";

let tray: Tray | null = null;
let popover: BrowserWindow | null = null;
let unread = false;

function buildPopover(): BrowserWindow {
  const win = new BrowserWindow({
    width: POPOVER_WIDTH,
    height: POPOVER_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    fullscreenable: false,
    backgroundColor: "#0d1117",
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
  win.on("blur", () => win.hide());
  return win;
}

function toggle(): void {
  if (!tray) return;
  if (!popover) popover = buildPopover();
  if (popover.isVisible()) {
    popover.hide();
    return;
  }
  const b = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;
  const at = popoverBounds(b, display, {
    width: POPOVER_WIDTH,
    height: POPOVER_HEIGHT,
  });
  popover.setPosition(at.x, at.y, false);
  popover.show();
  // Reading the brief is what clears the dot.
  setUnread(false);
}

export function setUnread(next: boolean): void {
  unread = next;
  tray?.setTitle(trayTitle(unread));
}

export function startAtlasTray(): void {
  if (tray) return;
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle(trayTitle(unread));
  tray.setToolTip("Atlas");
  tray.on("click", toggle);
}

export function stopAtlasTray(): void {
  popover?.destroy();
  popover = null;
  tray?.destroy();
  tray = null;
}
