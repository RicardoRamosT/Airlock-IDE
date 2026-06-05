import path from "node:path";
import { captureLoginEnv } from "@airlock/agent-core";
import { app, BrowserWindow, nativeImage } from "electron";
import { getWorkspaceRoot, killAllSessions, registerIpc } from "./ipc";
import { ensureMcpConfig } from "./mcp/config";
import { startMcpServer, stopMcpServer } from "./mcp/server";
import { applyAppMenu } from "./menu";
import { loadPrefs } from "./prefs";

app.setName("airlock");

// Single-instance lock (#13): two Airlocks would contend over the same
// project's .airlock/ files (secrets meta, audit chain). If we don't get the
// lock, a primary is already running -- quit immediately and let the running
// "second-instance" handler focus the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  bootstrap();
}

// Captured once at startup: the real login-shell env (homebrew PATH, locale).
// A Finder-launched app inherits launchd's minimal env, so spawned terminals
// would otherwise miss the user's PATH and have a broken locale.
let loginEnv: Record<string, string> = {};

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

// Only invoked for the primary instance (we hold the single-instance lock).
// The secondary-instance path early-returns via app.quit() above and must NOT
// capture login env or create a window.
function bootstrap(): void {
  app.whenReady().then(async () => {
    // Capture the user's real login-shell env once, BEFORE any terminal can be
    // spawned. Best-effort: on failure this stays {} and PTYs fall back to
    // process.env unchanged.
    loginEnv = await captureLoginEnv();

    // Finder-launched packaged apps inherit launchd's minimal PATH (no
    // /opt/homebrew/bin), so the main process cannot resolve CLIs like `gh`
    // -- execFile("gh") fails ENOENT and the accounts panel wrongly reports
    // "not found". Adopt the captured login PATH for the main process so every
    // tool airlock shells out to (gh, git, and the agent's future run_command)
    // resolves against the user's real PATH. PTYs already build env from
    // loginEnv, so this only aligns main's own lookups -- no double effect.
    if (loginEnv.PATH) process.env.PATH = loginEnv.PATH;

    // Dev runs the stock Electron binary, which owns the dock identity; at least
    // give it our icon at runtime. Packaged builds get name+icon from the bundle.
    if (!app.isPackaged && process.platform === "darwin" && app.dock) {
      app.dock.setIcon(
        nativeImage.createFromPath(
          path.join(__dirname, "../../build/icon-512.png"),
        ),
      );
    }
    // App-global prefs live in userData (NOT per-project .airlock/). getPath
    // is only valid after the app is ready, so compute it here before wiring.
    const prefsFile = path.join(app.getPath("userData"), "prefs.json");
    registerIpc(() => loginEnv, prefsFile);
    createWindow();
    const prefs = await loadPrefs(prefsFile);
    applyAppMenu(prefsFile, prefs.sectionVisibility);

    // Stand up the local MCP server (loopback, bearer-guarded). Its identity
    // (stable port + token) is generated/persisted once. A start failure (e.g.
    // a busy port we could not bump past) must NOT take down the app -- log and
    // continue; the IDE works without the agent bridge.
    const { port, token } = await ensureMcpConfig(prefsFile);
    await startMcpServer(port, { prefsFile, getWorkspaceRoot, token }).catch(
      (e) => {
        console.error(
          "MCP server failed to start:",
          e instanceof Error ? e.message : e,
        );
      },
    );
  });

  app.on("before-quit", killAllSessions);
  // Tear down the MCP listener on quit (it intentionally outlives window-close
  // on darwin). Coexists with killAllSessions above.
  app.on("before-quit", () => {
    void stopMcpServer();
  });

  // macOS lifecycle (#12): on darwin the app stays alive when all windows close
  // (it is now stateful -- terminals, secrets, git -- so quitting would drop
  // live sessions). On other platforms keep the quit-on-close behavior.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // Re-open a window when the dock icon is clicked and none are open.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
