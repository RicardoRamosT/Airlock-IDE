import path from "node:path";
import { app, BrowserWindow, nativeImage } from "electron";
import { killAllSessions, registerIpc } from "./ipc";

app.setName("airlock");

function createWindow(): void {
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

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  // Dev runs the stock Electron binary, which owns the dock identity; at least
  // give it our icon at runtime. Packaged builds get name+icon from the bundle.
  if (!app.isPackaged && process.platform === "darwin" && app.dock) {
    app.dock.setIcon(
      nativeImage.createFromPath(
        path.join(__dirname, "../../build/icon-512.png"),
      ),
    );
  }
  registerIpc();
  createWindow();
});

app.on("before-quit", killAllSessions);

app.on("window-all-closed", () => {
  app.quit();
});
