import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import {
  captureLoginEnv,
  importAllDotEnv,
  unregisterMcpServer,
} from "@airlock/agent-core";
import { app, BrowserWindow, ipcMain, nativeImage } from "electron";

const execFileAsync = promisify(execFile);

import { activityStatus, addDismissedActivity } from "./activity";
import { registerAgentCommandIpc, runAgentCommand } from "./agent-commands";
import {
  gatedTerminalInput,
  registerAgentRequestIpc,
  requestSecretFromUser,
} from "./agent-requests";
import {
  startAnthropicStatusWatch,
  stopAnthropicStatusWatch,
} from "./anthropicStatus/watch";
import {
  getDevServerState,
  startDevServer,
  stopDevServer,
} from "./devserver/manager";
import {
  installConsoleFunnel,
  installProcessHandlers,
  wrapIpcHandle,
} from "./eventlog/capture";
import { emitEvent, flushEventLog, startEventLog } from "./eventlog/wire";
import {
  broadcastActivityChanged,
  flushSession,
  getTerminalTail,
  killAllSessions,
  listTerminals,
  registerIpc,
  terminalLabel,
  writeTerminalInput,
} from "./ipc";
import { ensureMcpConfig } from "./mcp/config";
import {
  configureScope,
  rootForToken,
  seedOpenRoots,
} from "./mcp/projectScope";
import { getMcpPort, startMcpServer, stopMcpServer } from "./mcp/server";
import { applyAppMenu, applyDockMenu } from "./menu";
import { loadPrefs, savePrefs } from "./prefs";
import { getQuota, getUsageLedger } from "./quota/watch";
import { reconcileQuotaMeter } from "./quota/wire";
import { reconcileRunSkill } from "./runskill/wire";
import { startUpdateCheck, stopUpdateCheck } from "./update/check";
import { allOpenRoots, createWindow } from "./window";

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

    // Event log capture: instrument ipcMain BEFORE any handler registers so the
    // wrapper is in place for every subsequent ipcMain.handle() call. Process
    // handlers and console funnel don't need prefs and are safe to start early.
    installProcessHandlers();
    installConsoleFunnel();
    wrapIpcHandle(ipcMain);
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
    // Event log: start the writer now that we know whether it's enabled and at
    // what level. emitEvent() is a no-op until this is called (writer is null).
    startEventLog(prefs.eventLog);
    emitEvent({ level: "info", category: "lifecycle", op: "app.ready" });
    // Quota meter: install/uninstall the chained Claude statusLine to match the
    // saved pref, then start watching the side-channel file. Best-effort -- a
    // failure to touch ~/.claude/settings.json must never break startup.
    await reconcileQuotaMeter(prefs.quotaMeter.enabled).catch((e) =>
      console.warn("[airlock] quota meter wiring failed", e),
    );
    // Run-app routing skill: install/remove the Claude skill to match the pref.
    // Best-effort -- a failure to touch ~/.claude/skills must never break startup.
    await reconcileRunSkill(prefs.runAppSkill.enabled).catch((e) =>
      console.warn("[airlock] run-app skill wiring failed", e),
    );
    applyAppMenu(
      prefsFile,
      prefs.sectionVisibility,
      prefs.recentFolders,
      prefs.openProjectsAsTabs,
    );
    applyDockMenu(prefs.openProjectsAsTabs, prefs.recentFolders);

    // Carry-forward: generate installSalt if absent (needed by projectScope
    // for per-project token derivation). Persisted once; stable across launches.
    let installSalt = prefs.installSalt ?? "";
    if (!installSalt) {
      installSalt = randomBytes(16).toString("hex");
      await savePrefs(prefsFile, { installSalt }).catch((e) =>
        console.warn("[airlock] could not persist installSalt", e),
      );
    }

    // Carry-forward: resolve the real claude binary once at startup so the
    // per-project shim can bake an absolute fallback path. Null if not found.
    let realClaudeAbs: string | null = null;
    try {
      const { stdout } = await execFileAsync("which", ["claude"]);
      const resolved = stdout.trim();
      if (resolved) realClaudeAbs = resolved;
    } catch {
      // claude not on PATH -- shim will still work if PATH is correct at spawn.
    }

    // Wire the project-scope registry: token derivation, shim/config rendering,
    // and the per-request rootForToken lookup. Must be called before startMcpServer
    // and before any pty spawn so ensureProjectScope is ready.
    const userDataDir = app.getPath("userData");
    const getServer = () => {
      const p = getMcpPort();
      return p ? { port: p, token } : null;
    };
    configureScope({ getServer, installSalt, userDataDir, realClaudeAbs });
    // Pre-register tokens for roots already open (restored tabs) so rootForToken
    // works for in-flight sessions before their first terminal spawn. Best-effort.
    seedOpenRoots(allOpenRoots()).catch((e) =>
      console.warn("[airlock] seedOpenRoots failed", e),
    );

    // Stand up the local MCP server (loopback, bearer-guarded). A start failure
    // (e.g. a busy port we could not bump past) must NOT take down the app --
    // log and continue; the IDE works without the agent bridge.
    await startMcpServer(port, {
      prefsFile,
      // Per-request root resolution: the server resolves the project root from
      // the URL path token (/mcp/<token>), not from GUI focus. Unknown token ->
      // null -> workspace-gated tools return NO_WORKSPACE (refuse).
      rootForToken,
      getBaseEnv: () => loginEnv,
      requestSecretFromUser,
      getTerminalTail,
      listTerminals,
      // send_terminal_input: gate the agent's bytes behind a one-time per-
      // terminal user grant (modal), then write them to the live pty. Value-free
      // outcome only -- never terminal output or a secret value.
      sendTerminalInput: (id, data) =>
        gatedTerminalInput(id, data, {
          write: writeTerminalInput,
          label: terminalLabel,
        }),
      // activityStatus self-filters dismissed ids, so the read tool reflects
      // dismissals automatically (same list the sidebar shows).
      getActivity: (root) => activityStatus(root),
      // Reuse B1's dismiss path: add the id + broadcast so an agent dismiss
      // updates every window's Activity panel live, exactly like activity:dismiss.
      dismissActivity: (entryId) => {
        addDismissedActivity(entryId);
        broadcastActivityChanged();
      },
      // plan_usage reads the account's Claude plan usage off the quota watcher:
      // the cached QuotaStatus + the per-session ledger. Usage metadata only --
      // no secret values.
      getQuota,
      getUsageLedger,
      // The IDE-control tools (tabs/split/terminals/page-tabs) drive the focused
      // window via this command round-trip. Layout control only -- ids/paths/page
      // names in, layout metadata out; it never returns a secret value.
      runAgentCommand,
      // import_env: agent-core's batch importer (discovery/vault/audit live
      // there; the tool sees names only), plus the live-refresh broadcast --
      // tell every window which project root changed so its SECRETS section
      // refetches (same all-windows pattern as quota:changed).
      importEnvFiles: (root, opts) => importAllDotEnv(root, opts),
      notifySecretsChanged: (root) => {
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.webContents.isDestroyed())
            w.webContents.send("secrets:changed", root);
        }
      },
      // Managed dev-server: start_dev_server/stop_dev_server tools and
      // host_status devServer field. Status metadata only -- never a secret.
      getDevServerState,
      startDevServer,
      stopDevServer,
      token,
    }).catch((e) => {
      console.error(
        "MCP server failed to start:",
        e instanceof Error ? e.message : e,
      );
    });

    // Bottom-bar Claude status: poll the Anthropic status page on a timer and
    // broadcast to the bar. Best-effort -- never blocks startup.
    startAnthropicStatusWatch();
    // Bottom-bar updater: check GitHub releases for a newer version. No-op in
    // dev (gated on app.isPackaged inside).
    startUpdateCheck(app.getVersion());

    // One-time migration: remove the stale account-wide user-scope airlock
    // registration from any prior AirLock version. Per-project scoping via
    // --mcp-config replaces it (Task 3). Idempotent and best-effort; a missing
    // entry is fine.
    void unregisterMcpServer({ scope: "user" }).catch(() => {});
  });

  app.on("before-quit", () => {
    flushSession(); // synchronous: persist the latest layout before teardown
    killAllSessions();
  });
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
  app.on("before-quit", () => {
    stopAnthropicStatusWatch();
    stopUpdateCheck();
  });
  app.on("before-quit", () => {
    emitEvent({ level: "info", category: "lifecycle", op: "app.quit" });
    void flushEventLog();
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
