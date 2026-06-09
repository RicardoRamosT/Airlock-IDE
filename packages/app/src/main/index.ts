import path from "node:path";
import {
  captureLoginEnv,
  registerMcpServer,
  unregisterMcpServer,
} from "@airlock/agent-core";
import { app, BrowserWindow, nativeImage } from "electron";
import { activityStatus, addDismissedActivity } from "./activity";
import { registerAgentCommandIpc, runAgentCommand } from "./agent-commands";
import {
  registerAgentRequestIpc,
  requestSecretFromUser,
} from "./agent-requests";
import {
  broadcastActivityChanged,
  getTerminalTail,
  killAllSessions,
  listTerminals,
  registerIpc,
} from "./ipc";
import { ensureMcpConfig } from "./mcp/config";
import { getMcpPort, startMcpServer, stopMcpServer } from "./mcp/server";
import { applyAppMenu, applyDockMenu } from "./menu";
import { loadPrefs } from "./prefs";
import { reconcileQuotaMeter } from "./quota/wire";
import { createWindow, lastFocusedRoot } from "./window";

app.setName("AirLock");
// The display name is "AirLock", but keep userData (prefs.json + the persisted
// MCP port/token) at the original lowercase "airlock" path so the rename does not
// orphan saved prefs or invalidate the already-registered MCP server URL. Keychain
// (service "airlock") and per-project .airlock/ dirs are separate and unaffected.
app.setPath("userData", path.join(app.getPath("appData"), "airlock"));

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

    // MCP identity (stable port + token), generated/persisted once. Resolved
    // before registerIpc so the onFolderOpen callback below can close over it.
    const { port, token } = await ensureMcpConfig(prefsFile);

    registerIpc(() => loginEnv, prefsFile);
    // Register the agent-request resolver IPC (renderer reports the user's
    // save/cancel for a request_secret prompt). The MCP tool that drives this
    // is wired in via requestSecretFromUser in the startMcpServer deps below.
    registerAgentRequestIpc();
    // Register the agent-command resolver IPC (renderer reports the resulting
    // layout for an IDE-control command). The MCP tools that drive this are wired
    // in via runAgentCommand in the startMcpServer deps below.
    registerAgentCommandIpc();
    createWindow();
    const prefs = await loadPrefs(prefsFile);
    // Quota meter: install/uninstall the chained Claude statusLine to match the
    // saved pref, then start watching the side-channel file. Best-effort -- a
    // failure to touch ~/.claude/settings.json must never break startup.
    await reconcileQuotaMeter(prefs.quotaMeter.enabled).catch((e) =>
      console.warn("[airlock] quota meter wiring failed", e),
    );
    applyAppMenu(
      prefsFile,
      prefs.sectionVisibility,
      prefs.recentFolders,
      prefs.openProjectsAsTabs,
    );
    applyDockMenu(prefs.openProjectsAsTabs, prefs.recentFolders);

    // Stand up the local MCP server (loopback, bearer-guarded). A start failure
    // (e.g. a busy port we could not bump past) must NOT take down the app --
    // log and continue; the IDE works without the agent bridge.
    await startMcpServer(port, {
      prefsFile,
      getWorkspaceRoot: lastFocusedRoot,
      getBaseEnv: () => loginEnv,
      requestSecretFromUser,
      getTerminalTail,
      listTerminals,
      // activityStatus self-filters dismissed ids, so the read tool reflects
      // dismissals automatically (same list the sidebar shows).
      getActivity: (root) => activityStatus(root),
      // Reuse B1's dismiss path: add the id + broadcast so an agent dismiss
      // updates every window's Activity panel live, exactly like activity:dismiss.
      dismissActivity: (entryId) => {
        addDismissedActivity(entryId);
        broadcastActivityChanged();
      },
      // The IDE-control tools (tabs/split/terminals) drive the focused window via
      // this command round-trip. Layout/terminal control only -- ids/paths in,
      // layout metadata out; it never returns a secret value.
      runAgentCommand,
      token,
    }).catch((e) => {
      console.error(
        "MCP server failed to start:",
        e instanceof Error ? e.message : e,
      );
    });

    // Make airlock's tools native to every terminal `claude` in this app:
    // register the MCP server in the user's global claude config so any claude
    // session here loads it on startup -- no per-project setup, no restart, no
    // manual `claude mcp add`. Removed again on quit (below) so a closed AirLock
    // leaves no dead "airlock" server in unrelated terminals. Gated on a live
    // bound port (skip if the server did not come up); idempotent + best-effort,
    // so a failure never disrupts the app.
    const livePort = getMcpPort();
    if (livePort) {
      const url = `http://127.0.0.1:${livePort}/mcp`;
      void registerMcpServer({ url, token, scope: "user" })
        .then((r) => {
          if (!r.ok && r.reason === "not_found") {
            // The `claude` CLI is not installed/on PATH; tell the user how to
            // wire it up by hand. NEVER print the real token -- use a placeholder.
            console.error(
              `airlock: 'claude' CLI not found; to connect manually run: claude mcp add --transport http airlock ${url} --scope user --header "Authorization: Bearer <token>"`,
            );
          } else if (!r.ok) {
            console.error("airlock: MCP registration failed:", r.message);
          }
        })
        .catch((err) => {
          console.error(
            "airlock: MCP registration threw:",
            err instanceof Error ? err.message : err,
          );
        });
    }
  });

  app.on("before-quit", killAllSessions);
  // Tear down the MCP listener on quit (it intentionally outlives window-close
  // on darwin). Coexists with killAllSessions above.
  app.on("before-quit", () => {
    void stopMcpServer();
  });
  // Remove the user-scope MCP registration so a closed AirLock leaves no dead
  // "airlock" server in unrelated terminals' claude sessions. Best-effort +
  // idempotent (nothing-to-remove is fine).
  app.on("before-quit", () => {
    void unregisterMcpServer({ scope: "user" });
  });

  // macOS lifecycle (#12): on darwin the app stays alive when all windows close
  // (it is now stateful -- terminals, secrets, git -- so quitting would drop
  // live sessions). On other platforms keep the quit-on-close behavior.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // Re-open a window when the dock icon is clicked and none are open. Guard on
  // app.isReady(): on macOS "activate" can fire DURING launch, before "ready",
  // and createWindow() before ready throws ("Cannot create BrowserWindow before
  // app is ready"). The initial window is created in whenReady() above, so a
  // pre-ready activate safely no-ops here.
  app.on("activate", () => {
    if (app.isReady() && BrowserWindow.getAllWindows().length === 0)
      createWindow();
  });
}
