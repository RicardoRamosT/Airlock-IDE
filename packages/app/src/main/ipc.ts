import { execFile, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  appendAudit,
  createBranch,
  createDir,
  createFile,
  createPtySession,
  deleteGlobalSecret,
  deleteSecret,
  detectInstalledTerminals,
  dockerStart,
  dockerStop,
  duplicate,
  filterDangerousEnv,
  getGlobalSecret,
  getSecretValue,
  ghAccounts,
  gitFetch,
  gitFileVersions,
  gitPull,
  gitPush,
  INTEGRATIONS,
  importAllDotEnv,
  importExternal,
  injectInto,
  isGitRepo,
  launchArgs,
  listBranches,
  listDirectory,
  listFilesRecursive,
  listSecrets,
  listTables,
  move,
  neonConnectionUri,
  type PtySession,
  parseConnString,
  pingDb,
  pollSteady,
  probePort,
  readAudit,
  readImageDataUrl,
  readOrder,
  readProjectConfig,
  readRows,
  readWorkspaceFile,
  redactConnStrings,
  redactedPreview,
  redactedTail,
  redactSecrets,
  resolveWithin,
  runGit,
  type SteadyCache,
  searchProject,
  setGlobalSecret,
  setSecret,
  stageFiles,
  switchBranch,
  switchGhAccount,
  targetsVault,
  unstageFiles,
  vaultedSecrets,
  withDb,
  writeFolderOrder,
  writeProjectConfig,
  writeWorkspaceFile,
} from "@airlock/agent-core";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
} from "electron";
import type { AppPrefs, Section, SessionSnapshot } from "../shared/ipc";
import { activityStatus, addDismissedActivity } from "./activity";
import { getAnthropicStatus } from "./anthropicStatus/watch";
import { syncWindowWatchers } from "./fsWatch";
import { ensureIdentityFor, resolveFor, tokenFor } from "./github/account";
import {
  dockerStatus,
  gitStatusFor,
  neonBranches,
  neonDatabases,
  neonProjects,
  neonStatus,
  renderServicesStatus,
  resolveDevUrl,
} from "./ide-state";
import {
  lspCompletion,
  lspDefinition,
  lspDidChange,
  lspDidClose,
  lspDidOpen,
  lspHover,
  lspReferences,
  onLspDiagnostics,
  syncLspServers,
} from "./lsp/client";
import { applyAppMenu, applyDockMenu, changeSectionVisibility } from "./menu";
import { gatherProfile } from "./overview/gather";
import {
  loadPrefs,
  RECENT_CAP,
  SECTIONS,
  sanitizeAgentPolicy,
  savePrefs,
} from "./prefs";
import { getQuota, getUsageLedger } from "./quota/watch";
import { reconcileQuotaMeter } from "./quota/wire";
import { guardedCommit } from "./secrets/commit";
import { readSession, writeSession } from "./session-store";
import { applyUpdate } from "./update/apply";
import { getUpdate } from "./update/check";
import {
  allOpenRoots,
  clearRootForEvent,
  isOpenRoot,
  lastFocusedRoot,
  lastFocusedWindowId,
  rootForEvent,
  setRootForEvent,
  setWindowRoots,
} from "./window";

const execFileP = promisify(execFile);

const sessions = new Map<string, PtySession>();

// Per-manifest steady-state poll cache, persisted across IPC calls so each
// manifest's everyMs cadence holds regardless of how often the sidebar polls.
const steadyCache: SteadyCache = {};

// Per-PTY owning window (sessionId -> BrowserWindow id). Terminal-reading agent
// tools are scoped to the agent's (last-focused) window, so a window only ever
// sees + reads its OWN terminals. Recorded in pty:create, deleted on exit.
const sessionWindows = new Map<string, number>();

// Per-PTY owning project root (sessionId -> workspace root). One tabbed window
// holds many projects' terminals at once, so window-scoping alone is too coarse:
// the agent must see ONLY the active tab's terminals. switchTab fires
// workspace:setActive, so lastFocusedRoot() == the active tab's root; a terminal
// is the agent's iff sessionRoots.get(id) === lastFocusedRoot(). Recorded in
// pty:create (from the PANE root the renderer passes at spawn; blank tabs have
// none and are never agent-visible), deleted on exit / killAllSessions.
const sessionRoots = new Map<string, string>();

// Per-PTY ring buffer of recent raw output (tee'd from onData). Bounded so it
// cannot grow unbounded; read (redacted) by get_terminal_tail. Deleted on exit.
const ptyBuffers = new Map<string, string>();
const TAIL_CAP = 256 * 1024; // bytes of raw output retained per terminal
const DEFAULT_TAIL_LINES = 40;
const MAX_TAIL_LINES = 400;
const PREVIEW_LINES = 3;

function requireRoot(e: { sender: Electron.WebContents }): string {
  const root = rootForEvent(e);
  if (!root) throw new Error("No workspace open");
  return root;
}

// Resolve which project a per-project IPC acts on. The renderer passes the
// PANE's root explicitly (two panes share one window, so the window root alone
// is ambiguous). Accept it only if it is a root the user actually opened in
// this window (defense in depth); otherwise fall back to the window root.
function resolveRoot(
  e: { sender: Electron.WebContents },
  explicit?: unknown,
): string {
  if (typeof explicit === "string" && explicit && isOpenRoot(e, explicit))
    return explicit;
  return requireRoot(e);
}

// Reject any path whose first segment is the .airlock vault dir (metadata; never
// mutated from the UI). Defense in depth -- the FileTree never shows .airlock.
function assertNotVault(relPath: string): void {
  // targetsVault normalizes "."/".." and checks every segment, so bypasses like
  // "./.airlock/x" or "sub/../.airlock/x" are caught (not just first-segment).
  if (targetsVault(relPath))
    throw new Error("The .airlock folder is protected");
}

// Whether the shell with this pid has a running child process. Used by
// pty:isBusy so opening a folder into a blank tab does not kill a terminal
// that is busy (e.g. a live `claude`). Synchronous `pgrep -P <pid>`: a child
// exists iff pgrep exits 0 with non-empty stdout. Missing pgrep / any error ->
// false (treat as idle). NEVER throws.
function ptyHasChild(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    const r = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
    if (r.error) return false;
    return r.status === 0 && (r.stdout ?? "").trim().length > 0;
  } catch {
    return false;
  }
}

// Tell every window the activity feed changed (no payload) so each ActivitySection
// refetches the now-filtered list. The dismissed set is app-global, so this fans
// out to ALL windows (like sections:changed). Reused by the activity:dismiss IPC
// and the later MCP dismiss tool.
export function broadcastActivityChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.webContents.isDestroyed()) w.webContents.send("activity:changed");
  }
}

const NEON_KEY = "NEON_API_KEY";
const RENDER_KEY = "RENDER_API_KEY";

// MAIN-ONLY: resolve a Neon branch/db connection URI (carries a password).
// NEVER returned over IPC -- only fed to withDb here.
async function neonUri(
  p: string,
  b: string,
  db: string,
  role: string,
): Promise<string> {
  const key = await getGlobalSecret(NEON_KEY);
  if (!key) throw new Error("Neon not connected");
  return neonConnectionUri(key, p, b, db, role);
}
const allStr = (xs: unknown[]): boolean =>
  xs.every((x) => typeof x === "string");

// Path to the layout snapshot, alongside prefs.json in userData.
const sessionFile = () => path.join(app.getPath("userData"), "session.json");

// Last snapshot the renderer reported, kept for the synchronous quit flush.
let latestSnapshot: SessionSnapshot | null = null;

// Synchronous best-effort flush of the latest snapshot, for app before-quit
// (async writes may not finish before the process exits).
export function flushSession(): void {
  if (!latestSnapshot) return;
  try {
    writeFileSync(
      sessionFile(),
      `${JSON.stringify(latestSnapshot, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
  } catch (err) {
    console.error("[airlock] session flush failed", err);
  }
}

// getBaseEnv supplies the login-shell env captured once at startup (real
// PATH, locale). pty:create uses it as the base for every terminal. Passed
// as an accessor so the latest captured value is read at spawn time and
// ipc.ts holds no module-level mutable state.
//
// prefsFile is the absolute path to the app-global prefs JSON (userData). The
// prefs:get/set handlers below are NOT requireRoot-gated -- preferences are
// app-global and must work before any folder is opened.
export function registerIpc(
  getBaseEnv: () => Record<string, string> = () => ({}),
  prefsFile = "",
): void {
  // App-global audit chain (userData-level), for global credential writes.
  const globalAuditLog = prefsFile
    ? path.join(path.dirname(prefsFile), "audit-global.jsonl")
    : "";

  // Register the LSP diagnostics sink once: broadcast to every open window.
  onLspDiagnostics((e) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.webContents.isDestroyed())
        w.webContents.send("lsp:diagnostics", e);
    }
  });

  // Open a workspace at a known path: set root, record the folder in recents
  // (most-recent-first, deduped, capped), and rebuild the menu so Open Recent
  // reflects it.
  async function recordAndOpen(
    e: { sender: Electron.WebContents },
    root: string,
  ): Promise<void> {
    setRootForEvent(e, root);
    const prev = await loadPrefs(prefsFile);
    const recents = [
      root,
      ...prev.recentFolders.filter((p) => p !== root),
    ].slice(0, RECENT_CAP);
    await savePrefs(prefsFile, { recentFolders: recents });
    applyAppMenu(
      prefsFile,
      prev.sectionVisibility,
      recents,
      prev.openProjectsAsTabs,
    );
    applyDockMenu(prev.openProjectsAsTabs, recents);
  }

  ipcMain.handle("dialog:openFolder", async (e) => {
    const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (r.canceled || r.filePaths.length === 0) return null;
    const picked = r.filePaths[0];
    if (!picked) return null;
    await recordAndOpen(e, picked);
    return picked;
  });

  ipcMain.handle("workspace:open", async (e, p: unknown) => {
    if (typeof p !== "string") throw new Error("Invalid payload");
    await recordAndOpen(e, p);
    return p;
  });

  // Point an already-open window at the project of the now-active tab. Unlike
  // workspace:open (which OPENS a folder), this is the lean tab-switch path: it
  // only moves the window's root, which re-points the agent (the MCP server
  // resolves the focused root dynamically via getWorkspaceRoot). It deliberately
  // does NOT touch recents or rebuild the menu -- switching tabs is not opening,
  // so it must not reorder Open Recent.
  ipcMain.handle("workspace:setActive", (e, p: unknown) => {
    if (typeof p !== "string") throw new Error("Invalid payload");
    // Already the active root for this window (a no-op self-switch or rapid tab
    // re-clicks): skip the redundant root write.
    if (rootForEvent(e) === p) return;
    setRootForEvent(e, p);
  });

  ipcMain.handle("workspace:close", (e) => {
    clearRootForEvent(e);
  });

  // The renderer reports the full set of roots open in this window (every tab's
  // root) on tab open/close. resolveRoot validates a per-project handler's
  // explicit root against this set, so the renderer can only ever point a
  // handler at a project the user actually opened (no arbitrary-path access).
  ipcMain.handle("workspace:roots", (e, roots: unknown) => {
    if (Array.isArray(roots)) {
      const list = roots.filter((r): r is string => typeof r === "string");
      setWindowRoots(e, list);
      syncWindowWatchers(e.sender, list);
      syncLspServers(allOpenRoots());
    }
  });

  // Pick a file to view; return it RELATIVE to the open folder (the viewer read
  // path is workspace-confined). null if cancelled, no folder open, or outside.
  ipcMain.handle("dialog:openFile", async (e) => {
    const root = rootForEvent(e);
    if (!root) return null;
    const r = await dialog.showOpenDialog({
      properties: ["openFile"],
      defaultPath: root,
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    const picked = r.filePaths[0];
    if (!picked) return null;
    const rel = path.relative(root, picked);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    return rel;
  });

  ipcMain.handle("fs:listDir", (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    return listDirectory(resolveRoot(e, root), relPath);
  });

  ipcMain.handle("fs:listAll", (e, root: unknown) =>
    listFilesRecursive(resolveRoot(e, root)),
  );

  ipcMain.handle("fs:search", (e, root: unknown, query: unknown) => {
    if (typeof query !== "string") throw new Error("Invalid payload");
    return searchProject(resolveRoot(e, root), query);
  });

  ipcMain.handle("fs:readFile", (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    return readWorkspaceFile(resolveRoot(e, root), relPath);
  });

  // True iff relPath is an existing FILE within root. Any failure (escape,
  // vault, missing, or a directory) returns false -- the terminal link provider
  // uses this to decide whether to underline a path, so it must never throw.
  ipcMain.handle("fs:exists", async (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") return false;
    try {
      assertNotVault(relPath);
      const abs = await resolveWithin(resolveRoot(e, root), relPath);
      return (await stat(abs)).isFile();
    } catch {
      return false;
    }
  });

  ipcMain.handle("overview:get", (e, root: unknown) => {
    if (typeof root !== "string" || !isOpenRoot(e, root))
      throw new Error("Invalid or unopened root");
    return gatherProfile(root);
  });

  ipcMain.handle("fs:readImage", (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    return readImageDataUrl(resolveRoot(e, root), relPath);
  });
  ipcMain.handle(
    "fs:openExternalFile",
    async (e, root: unknown, relPath: unknown) => {
      if (typeof relPath !== "string") throw new Error("Invalid payload");
      assertNotVault(relPath);
      const abs = await resolveWithin(resolveRoot(e, root), relPath);
      await shell.openPath(abs);
    },
  );
  ipcMain.handle(
    "fs:writeFile",
    (e, root: unknown, relPath: unknown, content: unknown) => {
      if (typeof relPath !== "string" || typeof content !== "string")
        throw new Error("Invalid payload");
      assertNotVault(relPath);
      return writeWorkspaceFile(resolveRoot(e, root), relPath, content);
    },
  );

  ipcMain.handle("fs:create", (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    return createFile(resolveRoot(e, root), relPath);
  });
  ipcMain.handle("fs:mkdir", (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    return createDir(resolveRoot(e, root), relPath);
  });
  ipcMain.handle(
    "fs:move",
    (e, root: unknown, fromRel: unknown, toRel: unknown) => {
      if (typeof fromRel !== "string" || typeof toRel !== "string")
        throw new Error("Invalid payload");
      assertNotVault(fromRel);
      assertNotVault(toRel);
      return move(resolveRoot(e, root), fromRel, toRel);
    },
  );
  ipcMain.handle("fs:duplicate", (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    return duplicate(resolveRoot(e, root), relPath);
  });
  ipcMain.handle(
    "fs:importExternal",
    (e, root: unknown, destRel: unknown, srcPaths: unknown) => {
      if (
        typeof destRel !== "string" ||
        !Array.isArray(srcPaths) ||
        !srcPaths.every((p) => typeof p === "string")
      )
        throw new Error("Invalid payload");
      assertNotVault(destRel);
      return importExternal(resolveRoot(e, root), destRel, srcPaths);
    },
  );
  ipcMain.handle("fs:trash", async (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    // resolveWithin returns the absolute, root-confined path for shell.trashItem.
    const abs = await resolveWithin(resolveRoot(e, root), relPath);
    await shell.trashItem(abs);
  });

  ipcMain.handle("fileOrder:get", (e, root: unknown) =>
    readOrder(resolveRoot(e, root)),
  );
  ipcMain.handle(
    "fileOrder:set",
    (e, root: unknown, folderRel: unknown, names: unknown) => {
      if (
        typeof folderRel !== "string" ||
        !Array.isArray(names) ||
        !allStr(names)
      )
        throw new Error("Invalid payload");
      return writeFolderOrder(
        resolveRoot(e, root),
        folderRel,
        names as string[],
      );
    },
  );

  ipcMain.handle(
    "lsp:didOpen",
    (
      e,
      root: unknown,
      relPath: unknown,
      languageId: unknown,
      version: unknown,
      text: unknown,
    ) => {
      if (
        typeof relPath !== "string" ||
        typeof languageId !== "string" ||
        typeof version !== "number" ||
        typeof text !== "string"
      )
        throw new Error("Invalid payload");
      return lspDidOpen(
        resolveRoot(e, root),
        relPath,
        languageId,
        version,
        text,
      );
    },
  );
  ipcMain.handle(
    "lsp:didChange",
    (e, root: unknown, relPath: unknown, version: unknown, text: unknown) => {
      if (
        typeof relPath !== "string" ||
        typeof version !== "number" ||
        typeof text !== "string"
      )
        throw new Error("Invalid payload");
      return lspDidChange(resolveRoot(e, root), relPath, version, text);
    },
  );
  ipcMain.handle("lsp:didClose", (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    return lspDidClose(resolveRoot(e, root), relPath);
  });
  ipcMain.handle(
    "lsp:hover",
    (e, root: unknown, relPath: unknown, line: unknown, character: unknown) => {
      if (
        typeof relPath !== "string" ||
        typeof line !== "number" ||
        typeof character !== "number"
      )
        throw new Error("Invalid payload");
      return lspHover(resolveRoot(e, root), relPath, line, character);
    },
  );
  ipcMain.handle(
    "lsp:completion",
    (e, root: unknown, relPath: unknown, line: unknown, character: unknown) => {
      if (
        typeof relPath !== "string" ||
        typeof line !== "number" ||
        typeof character !== "number"
      )
        throw new Error("Invalid payload");
      return lspCompletion(resolveRoot(e, root), relPath, line, character);
    },
  );
  ipcMain.handle(
    "lsp:definition",
    (e, root: unknown, relPath: unknown, line: unknown, character: unknown) => {
      if (
        typeof relPath !== "string" ||
        typeof line !== "number" ||
        typeof character !== "number"
      )
        throw new Error("Invalid payload");
      return lspDefinition(resolveRoot(e, root), relPath, line, character);
    },
  );
  ipcMain.handle(
    "lsp:references",
    (e, root: unknown, relPath: unknown, line: unknown, character: unknown) => {
      if (
        typeof relPath !== "string" ||
        typeof line !== "number" ||
        typeof character !== "number"
      )
        throw new Error("Invalid payload");
      return lspReferences(resolveRoot(e, root), relPath, line, character);
    },
  );

  ipcMain.handle("secrets:list", (e, root: unknown) =>
    listSecrets(resolveRoot(e, root)),
  );

  ipcMain.handle("secrets:set", async (e, root: unknown, name, value) => {
    if (typeof name !== "string" || typeof value !== "string") {
      throw new Error("Invalid payload");
    }
    const resolved = resolveRoot(e, root);
    // Rotation: capture the OLD value first, then scrub it from PTY buffers so a
    // get_terminal_tail can't return the superseded value. (audit PB-H4)
    const old = await getSecretValue(resolved, name);
    const meta = await setSecret(resolved, name, value);
    if (old !== null && old !== value) scrubSecretFromBuffers(old);
    return meta;
  });

  ipcMain.handle("secrets:delete", async (e, root: unknown, name) => {
    if (typeof name !== "string") throw new Error("Invalid payload");
    const resolved = resolveRoot(e, root);
    // Scrub the deleted value from PTY buffers (it just left the vault, so the
    // tail redactor would no longer mask it). (audit PB-H4)
    const old = await getSecretValue(resolved, name);
    await deleteSecret(resolved, name);
    if (old !== null) scrubSecretFromBuffers(old);
  });

  // OWNER-ONLY value path. The renderer is the human's surface; the agent (a
  // separate process, reachable only over MCP) cannot call this IPC and is NOT
  // given any value tool. Audited (name only). See broker.getSecretValue banner.
  ipcMain.handle("secrets:reveal", async (e, root: unknown, name: unknown) => {
    if (typeof name !== "string") throw new Error("Invalid payload");
    const resolved = resolveRoot(e, root);
    await appendAudit(resolved, "user", "secret.reveal", { name });
    return getSecretValue(resolved, name);
  });

  // Copy by NAME so the value never enters the renderer: main resolves it, puts
  // it on the clipboard, and conditionally auto-clears after the configured delay
  // (0 = never; clears only if the clipboard still holds this exact value).
  ipcMain.handle(
    "clipboard:copySecret",
    async (e, root: unknown, name: unknown) => {
      if (typeof name !== "string") throw new Error("Invalid payload");
      // Explicit PANE root (resolveRoot, validated against open roots) -- not the
      // window's active root -- so copying a secret from a non-focused split pane
      // never grabs the wrong project's value.
      const resolved = resolveRoot(e, root);
      const value = await getSecretValue(resolved, name);
      if (value === null) return { copied: false, clearAfterSeconds: 0 };
      clipboard.writeText(value);
      await appendAudit(resolved, "user", "secret.copy", { name });
      const seconds = (await loadPrefs(prefsFile)).clipboardClearSeconds;
      if (seconds > 0) {
        setTimeout(() => {
          if (clipboard.readText() === value) clipboard.writeText("");
        }, seconds * 1000);
      }
      return { copied: true, clearAfterSeconds: seconds };
    },
  );

  ipcMain.handle(
    "secrets:importEnv",
    (e, root: unknown, deleteAfter: unknown) => {
      // Explicit PANE root so .env imports land in the project of the pane the
      // button was clicked in, not the window's active pane. The renderer no
      // longer supplies a path: main discovers the importable env files itself
      // (.env + .env.*, templates excluded), so this surface cannot be aimed
      // at an arbitrary file.
      return importAllDotEnv(resolveRoot(e, root), {
        deleteAfter: deleteAfter === true,
      });
    },
  );

  ipcMain.handle("config:get", (e, root: unknown) =>
    readProjectConfig(resolveRoot(e, root)),
  );

  ipcMain.handle("config:set", (e, root: unknown, patch: unknown) => {
    if (!patch || typeof patch !== "object") throw new Error("Invalid payload");
    const p = patch as {
      injectSecretsIntoTerminal?: unknown;
      devUrl?: unknown;
    };
    const clean: { injectSecretsIntoTerminal?: boolean; devUrl?: string } = {};
    if (typeof p.injectSecretsIntoTerminal === "boolean")
      clean.injectSecretsIntoTerminal = p.injectSecretsIntoTerminal;
    if (typeof p.devUrl === "string") clean.devUrl = p.devUrl;
    return writeProjectConfig(resolveRoot(e, root), clean);
  });

  ipcMain.handle("terminal:listExternal", () => detectInstalledTerminals());

  ipcMain.handle("terminal:openExternal", async (e, root: unknown) => {
    if (typeof root !== "string" || !root) throw new Error("Invalid payload");
    if (!isOpenRoot(e, root)) return; // only open workspaces; never an arbitrary path
    const prefs = await loadPrefs(prefsFile);
    const id = prefs.defaultTerminal;
    const spec = launchArgs(id, root);
    if (!spec) return; // "airlock" or unknown -> nothing to launch externally
    try {
      await execFileP(spec.cmd, spec.args, { timeout: 8000 }); // 8s safety bound; `open` returns immediately, this only guards a hang
    } catch (err) {
      console.error("[terminal] open external failed", err);
    }
  });

  // App-global prefs: NOT requireRoot-gated (work with no folder open).
  ipcMain.handle("prefs:get", () => loadPrefs(prefsFile));

  ipcMain.handle("quota:get", () => getQuota());
  ipcMain.handle("anthropicStatus:get", () => getAnthropicStatus());
  ipcMain.handle("update:get", () => getUpdate());
  ipcMain.handle("update:apply", () => applyUpdate());

  // usage:get -> SessionUsage[] for the Usage dashboard (sorted by output
  // tokens, the cost proxy on subscription plans).
  ipcMain.handle("usage:get", () => getUsageLedger());

  // Session restore: read the persisted layout snapshot; save the latest one
  // (async, serialized, best-effort) and hold it for the synchronous quit flush.
  // App-global (NOT root-gated). Value-free: roots + booleans only.
  ipcMain.handle("session:get", () => readSession(sessionFile()));
  ipcMain.on("session:save", (_e, snap: SessionSnapshot) => {
    latestSnapshot = snap;
    void writeSession(sessionFile(), snap); // async, serialized, best-effort
  });

  ipcMain.handle("prefs:set", async (_e, patch: unknown) => {
    if (!patch || typeof patch !== "object") throw new Error("Invalid payload");
    const saved = await savePrefs(prefsFile, patch as Partial<AppPrefs>);
    // Flipping the tabs-vs-windows toggle relabels the File-menu + dock "New"
    // item (New Tab <-> New Window) live, so rebuild both menus from the
    // freshly persisted prefs.
    if ("openProjectsAsTabs" in (patch as object)) {
      const p = await loadPrefs(prefsFile);
      applyAppMenu(
        prefsFile,
        p.sectionVisibility,
        p.recentFolders,
        p.openProjectsAsTabs,
      );
      applyDockMenu(p.openProjectsAsTabs, p.recentFolders);
    }
    // Flipping the quota-meter toggle installs/removes the chained Claude
    // statusLine live (best-effort; never throw out of prefs:set).
    if ("quotaMeter" in (patch as object)) {
      const p = await loadPrefs(prefsFile);
      await reconcileQuotaMeter(p.quotaMeter.enabled).catch((e) =>
        console.warn("[airlock] quota meter reconcile failed", e),
      );
    }
    return saved;
  });

  // App-global (NOT requireRoot-gated): toggle a sidebar section's visibility.
  // Funnels through changeSectionVisibility, which persists the full map,
  // rebuilds the menu, and pushes "sections:changed" to the renderer.
  ipcMain.handle("sections:set", (_e, id: unknown, visible: unknown) => {
    if (
      typeof id !== "string" ||
      !SECTIONS.includes(id as Section) ||
      typeof visible !== "boolean"
    ) {
      throw new Error("Invalid payload");
    }
    return changeSectionVisibility(prefsFile, id as Section, visible);
  });

  // App-global (NOT requireRoot-gated): read and write the per-category agent
  // command policy. get returns the current policy; set sanitizes then persists.
  ipcMain.handle(
    "agentPolicy:get",
    async () => (await loadPrefs(prefsFile)).agentPolicy,
  );
  ipcMain.handle("agentPolicy:set", async (_e, policy: unknown) => {
    const clean = sanitizeAgentPolicy(policy);
    return (await savePrefs(prefsFile, { agentPolicy: clean })).agentPolicy;
  });

  ipcMain.handle("audit:read", (e, root: unknown, limit: unknown) =>
    readAudit(
      resolveRoot(e, root),
      typeof limit === "number" && Number.isFinite(limit) && limit > 0
        ? Math.floor(limit)
        : 50,
    ),
  );

  ipcMain.handle("git:isRepo", (e, root: unknown) =>
    isGitRepo(resolveRoot(e, root)),
  );

  ipcMain.handle("git:status", (e, root: unknown) =>
    gitStatusFor(resolveRoot(e, root)),
  );

  ipcMain.handle("git:stage", (e, root: unknown, paths: unknown) => {
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== "string")) {
      throw new Error("Invalid payload");
    }
    return stageFiles(resolveRoot(e, root), paths as string[]);
  });

  ipcMain.handle("git:unstage", (e, root: unknown, paths: unknown) => {
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== "string")) {
      throw new Error("Invalid payload");
    }
    return unstageFiles(resolveRoot(e, root), paths as string[]);
  });

  ipcMain.handle("git:commit", async (e, root: unknown, message: unknown) => {
    if (typeof message !== "string") throw new Error("Invalid payload");
    const resolved = resolveRoot(e, root);
    await ensureIdentityFor(resolved); // author commits as the project's account
    return guardedCommit(resolved, message, { gated: false });
  });

  ipcMain.handle("git:branches", (e, root: unknown) =>
    listBranches(resolveRoot(e, root)),
  );

  ipcMain.handle("git:fetch", async (e, root: unknown) => {
    const resolved = resolveRoot(e, root);
    return gitFetch(resolved, await tokenFor(resolved));
  });
  ipcMain.handle("git:pull", async (e, root: unknown) => {
    const resolved = resolveRoot(e, root);
    return gitPull(resolved, await tokenFor(resolved));
  });
  ipcMain.handle("git:push", async (e, root: unknown) => {
    const resolved = resolveRoot(e, root);
    return gitPush(resolved, await tokenFor(resolved));
  });

  ipcMain.handle("git:switchBranch", (e, root: unknown, name: unknown) => {
    if (typeof name !== "string") throw new Error("Invalid payload");
    return switchBranch(resolveRoot(e, root), name);
  });

  ipcMain.handle("git:createBranch", (e, root: unknown, name: unknown) => {
    if (typeof name !== "string") throw new Error("Invalid payload");
    return createBranch(resolveRoot(e, root), name);
  });

  ipcMain.handle(
    "git:fileVersions",
    (e, root: unknown, relPath: unknown, which: unknown) => {
      if (
        typeof relPath !== "string" ||
        (which !== "staged" && which !== "unstaged")
      ) {
        throw new Error("Invalid payload");
      }
      return gitFileVersions(resolveRoot(e, root), relPath, which);
    },
  );

  // GitHub accounts + commit identity: NOT requireRoot-gated. gh accounts are
  // app-global and must list with no folder open; the repo identity is just
  // null then. gh redacts tokens, so airlock never sees credentials.
  ipcMain.handle("github:info", async (e) => {
    const gh = await ghAccounts();
    let name: string | null = null;
    let email: string | null = null;
    const root = rootForEvent(e);
    if (root) {
      try {
        name = (await runGit(root, ["config", "user.name"])).trim() || null;
      } catch {}
      try {
        email = (await runGit(root, ["config", "user.email"])).trim() || null;
      } catch {}
    }
    return { gh, identity: { name, email } };
  });

  ipcMain.handle("github:switch", (_e, host: unknown, username: unknown) => {
    if (typeof host !== "string" || typeof username !== "string") {
      throw new Error("Invalid payload");
    }
    return switchGhAccount(host, username);
  });

  // Per-project account: which account a project resolves to (for the Git
  // section readout), and a setter that persists/clears a manual override.
  ipcMain.handle("github:resolveAccount", (e, root: unknown) =>
    resolveFor(resolveRoot(e, root)),
  );
  ipcMain.handle(
    "github:setProjectAccount",
    async (e, root: unknown, account: unknown) => {
      const resolved = resolveRoot(e, root);
      const acct =
        account &&
        typeof account === "object" &&
        typeof (account as { host?: unknown }).host === "string" &&
        typeof (account as { username?: unknown }).username === "string"
          ? {
              host: (account as { host: string }).host,
              username: (account as { username: string }).username,
            }
          : undefined; // null/invalid => clear the override (back to auto)
      await writeProjectConfig(resolved, { githubAccount: acct });
      await ensureIdentityFor(resolved); // apply the new account's identity now
    },
  );

  // Databases. The connection string (with its password) is resolved MAIN-SIDE
  // from the broker by secret name and used ONLY to open a short-lived pg
  // connection. It is NEVER returned over IPC -- the renderer gets host /
  // database / table names / row data and, on error, a message string only.
  // db:* are requireRoot-gated (via dbConnString / db:list).

  // Resolve a vaulted postgres-url secret to its connection string, MAIN-SIDE
  // only. The string (with password) is used to connect and never leaves main.
  // `root` is the pane's explicit root (validated by resolveRoot); the DB
  // handlers below resolve it once and pass it in so every db:* call acts on
  // the same project the renderer addressed.
  async function dbConnString(root: string, id: string): Promise<string> {
    const value = await getSecretValue(root, id);
    if (!value) throw new Error("Database secret not found");
    return value;
  }

  ipcMain.handle("db:list", async (e, root: unknown) => {
    const resolved = resolveRoot(e, root);
    const metas = (await listSecrets(resolved)).filter(
      (m) => m.provider === "postgres-url",
    );
    const out = [];
    for (const m of metas) {
      const value = await getSecretValue(resolved, m.name);
      const info = value ? parseConnString(value) : null;
      if (info) {
        out.push({
          id: m.name,
          host: info.host,
          database: info.database,
          user: info.user,
          redacted: info.redacted,
        });
      } else {
        // Unparseable -> a placeholder projection, NEVER the raw value.
        out.push({
          id: m.name,
          host: "",
          database: "(unparseable)",
          user: "",
          redacted: m.name,
        });
      }
    }
    return out; // NO password field
  });

  ipcMain.handle("db:ping", async (e, root: unknown, id: unknown) => {
    if (typeof id !== "string") throw new Error("Invalid payload");
    try {
      await withDb(await dbConnString(resolveRoot(e, root), id), (run) =>
        pingDb(run),
      );
      return { ok: true };
    } catch (err) {
      // Message-only: never the connection string / stack / error object.
      // redactConnStrings is the enforcing layer: even if a pg upgrade or a
      // DNS/driver error echoes the full connstr, the password is scrubbed
      // before it crosses IPC to the renderer.
      return {
        ok: false,
        error: redactConnStrings(
          err instanceof Error ? err.message : String(err),
        ),
      };
    }
  });

  ipcMain.handle("db:tables", async (e, root: unknown, id: unknown) => {
    if (typeof id !== "string") throw new Error("Invalid payload");
    try {
      return await withDb(await dbConnString(resolveRoot(e, root), id), (run) =>
        listTables(run),
      );
    } catch (err) {
      // Message-only, never the connection string / stack. redactConnStrings is
      // the enforcing layer; we deliberately do NOT attach `cause` so the raw
      // error object (which could carry the connstr) never crosses IPC.
      throw new Error(
        redactConnStrings(err instanceof Error ? err.message : String(err)),
      );
    }
  });

  ipcMain.handle(
    "db:rows",
    async (
      e,
      root: unknown,
      id: unknown,
      schema: unknown,
      table: unknown,
      limit: unknown,
    ) => {
      if (
        typeof id !== "string" ||
        typeof schema !== "string" ||
        typeof table !== "string"
      ) {
        throw new Error("Invalid payload");
      }
      const lim = typeof limit === "number" ? limit : 100;
      // explorer.readRows quotes identifiers and clamps the limit; on a query
      // error withDb rejects with a pg Error whose .message may echo the SQL.
      // The renderer surfaces err.message only, and redactConnStrings is the
      // enforcing layer that scrubs any connstr from that message. We rethrow a
      // fresh Error with NO `cause` so the raw error object (which could carry
      // the connstr) never crosses IPC.
      try {
        return await withDb(
          await dbConnString(resolveRoot(e, root), id),
          (run) => readRows(run, schema, table, lim),
        );
      } catch (err) {
        throw new Error(
          redactConnStrings(err instanceof Error ? err.message : String(err)),
        );
      }
    },
  );

  // Neon: app-global (account-level), so NOT requireRoot-gated. The API key
  // and any fetched connection URI stay main-only; only metadata/rows cross.
  ipcMain.handle("neon:status", () => neonStatus());
  ipcMain.handle("neon:connect", async (_e, key: unknown) => {
    if (typeof key !== "string" || !key.trim())
      throw new Error("Invalid payload");
    await setGlobalSecret(NEON_KEY, key.trim(), { auditLog: globalAuditLog });
    return { connected: true };
  });
  ipcMain.handle("neon:disconnect", async () => {
    // Clears the stored Neon API key (the global keychain entry). Lets the user
    // recover from a bad/stale key -- e.g. a connection string mistakenly
    // pasted here, which then 401s forever with no other way to clear it.
    await deleteGlobalSecret(NEON_KEY, { auditLog: globalAuditLog });
    return { connected: false };
  });
  ipcMain.handle("neon:projects", () => neonProjects());
  ipcMain.handle("neon:branches", (_e, p: unknown) => {
    if (typeof p !== "string") throw new Error("Invalid payload");
    return neonBranches(p);
  });
  ipcMain.handle("neon:databases", (_e, p: unknown, b: unknown) => {
    if (!allStr([p, b])) throw new Error("Invalid payload");
    return neonDatabases(p as string, b as string);
  });
  ipcMain.handle("neon:ping", async (_e, p, b, db, role) => {
    if (!allStr([p, b, db, role])) throw new Error("Invalid payload");
    try {
      await withDb(await neonUri(p, b, db, role), (run) => pingDb(run));
      return { ok: true };
    } catch (err) {
      // Message-only, scrubbed: a Neon connection URI carries a password, so
      // redactConnStrings is the enforcing layer even if a driver/DNS error
      // echoes the full URI before it crosses IPC.
      return {
        ok: false,
        error: redactConnStrings(
          err instanceof Error ? err.message : String(err),
        ),
      };
    }
  });
  ipcMain.handle("neon:tables", async (_e, p, b, db, role) => {
    if (!allStr([p, b, db, role])) throw new Error("Invalid payload");
    try {
      return await withDb(await neonUri(p, b, db, role), (run) =>
        listTables(run),
      );
    } catch (err) {
      // Fresh Error, NO `cause`: the raw error object (which could carry the
      // connection URI) never crosses IPC; the scrubbed message is all that does.
      throw new Error(
        redactConnStrings(err instanceof Error ? err.message : String(err)),
      );
    }
  });
  ipcMain.handle(
    "neon:rows",
    async (_e, p, b, db, role, schema, table, limit) => {
      if (!allStr([p, b, db, role, schema, table]))
        throw new Error("Invalid payload");
      const lim = typeof limit === "number" ? limit : 100;
      try {
        return await withDb(await neonUri(p, b, db, role), (run) =>
          readRows(run, schema as string, table as string, lim),
        );
      } catch (err) {
        // Fresh Error, NO `cause` (mirrors db:rows): scrubbed message only.
        throw new Error(
          redactConnStrings(err instanceof Error ? err.message : String(err)),
        );
      }
    },
  );

  // Render: app-global (account-level), so NOT requireRoot-gated. Mirrors the
  // neon:status/connect shape -- the API key stays main-only and is NEVER
  // returned over IPC. render:services returns an enriched status projection
  // (id/name/url/branch/deployStatus/deployed) with NO key and NO secrets.
  ipcMain.handle("render:status", async () => ({
    connected: (await getGlobalSecret(RENDER_KEY)) !== null,
  }));
  ipcMain.handle("render:connect", async (_e, key: unknown) => {
    if (typeof key !== "string" || !key.trim())
      throw new Error("Invalid payload");
    await setGlobalSecret(RENDER_KEY, key.trim(), { auditLog: globalAuditLog });
    return { connected: true };
  });
  ipcMain.handle("render:services", (e) =>
    renderServicesStatus(rootForEvent(e)),
  );

  // Host/local dev server: host:probe + host:openExternal are global (NOT
  // requireRoot-gated). host:localUrl resolves the per-project dev URL so it IS
  // requireRoot-gated (config.devUrl, else guessed from package.json).
  // Per-project dev URL (config.devUrl, else guessed from package.json). Shape
  // is unchanged (string | null); the resolution logic lives in ide-state's
  // resolveDevUrl so hostStatus (MCP) shares the exact same URL guess.
  ipcMain.handle("host:localUrl", (e, root: unknown) =>
    resolveDevUrl(resolveRoot(e, root)),
  );
  ipcMain.handle("host:probe", async (_e, url: unknown) => {
    if (typeof url !== "string") throw new Error("Invalid payload");
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return { up: false };
    }
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    return { up: await probePort(u.hostname, port) };
  });
  // Validate http(s) BEFORE opening: never file:// or a custom scheme.
  ipcMain.handle("host:openExternal", (_e, url: unknown) => {
    if (typeof url !== "string" || !/^https?:\/\//.test(url))
      throw new Error("Invalid payload");
    return shell.openExternal(url);
  });

  // Docker: machine-global, so NOT requireRoot-gated.
  ipcMain.handle("docker:list", () => dockerStatus());

  // activity:status -> ActivityItem[]; NOT requireRoot-gated (render/docker work
  // with no folder; activityStatus skips CI itself when there is no root). The
  // renderer passes the PANE's root explicitly (the one shared sidebar follows
  // the focused pane, and an implicit window root would race the focus sync);
  // validate it like resolveRoot does, degrading to global-only items.
  ipcMain.handle("activity:status", (e, root?: unknown) =>
    activityStatus(
      typeof root === "string" && root && isOpenRoot(e, root) ? root : null,
    ),
  );

  // integrations:steady -> SteadyIntegration[] for the sidebar steady surface.
  // Account-wide (a warehouse/service is not project-scoped), so no root.
  ipcMain.handle("integrations:steady", () =>
    pollSteady(INTEGRATIONS, null, Date.now(), steadyCache),
  );

  // activity:dismiss -> add an id to the app-global dismissed set, then broadcast
  // so every window's ActivitySection refetches the filtered feed live. The same
  // path the later MCP dismiss tool will reuse. A new run/deploy (new id) reappears.
  ipcMain.handle("activity:dismiss", (_e, id: unknown) => {
    if (typeof id === "string") {
      addDismissedActivity(id);
      broadcastActivityChanged();
    }
  });

  ipcMain.handle("docker:start", (_e, id: unknown) => {
    if (typeof id !== "string") throw new Error("Invalid payload");
    return dockerStart(id);
  });

  ipcMain.handle("docker:stop", (_e, id: unknown) => {
    if (typeof id !== "string") throw new Error("Invalid payload");
    return dockerStop(id);
  });

  ipcMain.handle(
    "pty:create",
    async (e, cols: number, rows: number, paneRoot: unknown) => {
      // The PANE's root, passed explicitly by TerminalPane (null = blank tab).
      // Deliberately NO window-root fallback: a blank tab must spawn a fresh
      // shell in $HOME and must NOT inherit the previously focused project's
      // cwd or injected secrets (QA 2026-06-11). isOpenRoot is the same
      // defense-in-depth gate resolveRoot uses; an unknown root degrades to
      // the blank-tab behavior, the safe direction.
      const root =
        typeof paneRoot === "string" && paneRoot && isOpenRoot(e, paneRoot)
          ? paneRoot
          : null;
      let secretEnv: Record<string, string> | undefined;
      if (root) {
        const cfg = await readProjectConfig(root);
        if (cfg.injectSecretsIntoTerminal) {
          try {
            const r = await injectInto(root, {});
            const { safe, blocked } = filterDangerousEnv(r.env);
            secretEnv = safe;
            if (blocked.length > 0) {
              await appendAudit(root, "user", "secret.inject.blocked", {
                names: blocked,
                reason: "dangerous env name at spawn site",
              });
            }
          } catch (err) {
            // Fail-closed is for agent actions (spec section 10); a human's
            // terminal must still open - just without secrets, which is the
            // safe direction.
            console.error(
              "[pty:create] injection/audit failed, spawning without secrets:",
              err instanceof Error ? err.message : String(err),
            );
            secretEnv = undefined;
          }
        }
      }
      const s = createPtySession({
        cwd: root ?? undefined,
        cols,
        rows,
        // Captured login-shell env (legitimate PATH/locale) is the base; it is
        // NOT run through filterDangerousEnv. Injected secrets (already filtered
        // above) are the per-call env and still win over baseEnv.
        baseEnv: getBaseEnv(),
        env: secretEnv,
      });
      sessions.set(s.id, s);
      const ownerId = BrowserWindow.fromWebContents(e.sender)?.id;
      if (ownerId !== undefined) sessionWindows.set(s.id, ownerId);
      // Tag the terminal with the project it was spawned under -- the SAME captured
      // `root` used for the spawn cwd above, NOT a re-read of rootForEvent(e). A
      // workspace:setActive can run during the awaits above and change what
      // rootForEvent(e) returns, so re-reading here would tag the session with a
      // different project than it actually spawned in. (audit PB-C2)
      if (root) sessionRoots.set(s.id, root);
      const wc = e.sender;
      const dataSub = s.onData((data) => {
        const prev = ptyBuffers.get(s.id) ?? "";
        const next = prev + data;
        ptyBuffers.set(
          s.id,
          next.length > TAIL_CAP ? next.slice(-TAIL_CAP) : next,
        );
        if (!wc.isDestroyed()) wc.send("pty:data", { id: s.id, data });
      });
      const exitSub = s.onExit((exitCode) => {
        sessions.delete(s.id);
        ptyBuffers.delete(s.id);
        sessionWindows.delete(s.id);
        sessionRoots.delete(s.id);
        if (!wc.isDestroyed()) wc.send("pty:exit", { id: s.id, exitCode });
        // Release the listeners explicitly. node-pty has no destroy(); kill()
        // is teardown, but the onData/onExit subscriptions are IDisposables
        // that should be disposed once the session has exited.
        dataSub.dispose();
        exitSub.dispose();
      });
      return s.id;
    },
  );

  // Whether a terminal's shell has a running child (e.g. a live `claude`).
  // Renderer->main UI ONLY (the open-folder helper consults it so a busy
  // terminal is preserved); the agent never calls this -- it is NOT an MCP tool
  // and carries only a session id. Scoped to the sender window's own sessions
  // (consistent with the other pty/terminal handlers). Returns a plain boolean;
  // never throws.
  // True iff the SENDER window owns this pty session. pty:isBusy and the mutating
  // handlers (input/resize/kill) gate on it so one window cannot drive (inject
  // into / resize / kill) another window's pty. Denies when no owner is recorded
  // or the sender's window can't be resolved (the safe direction). (audit PB-H6)
  const ownsSession = (
    e: { sender: Electron.WebContents },
    id: string,
  ): boolean => {
    const ownerId = BrowserWindow.fromWebContents(e.sender)?.id;
    return ownerId !== undefined && sessionWindows.get(id) === ownerId;
  };

  ipcMain.handle("pty:isBusy", (e, id: unknown) => {
    if (typeof id !== "string") return false;
    if (!ownsSession(e, id)) return false;
    const s = sessions.get(id);
    if (!s) return false;
    return ptyHasChild(s.pid);
  });

  ipcMain.on("pty:input", (e, payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const { id, data } = payload as { id: string; data: string };
    if (typeof id !== "string" || typeof data !== "string") return;
    if (!ownsSession(e, id)) return; // cross-window injection guard (PB-H6)
    sessions.get(id)?.write(data);
  });

  ipcMain.on("pty:resize", (e, payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const { id, cols, rows } = payload as {
      id: string;
      cols: number;
      rows: number;
    };
    if (
      typeof id !== "string" ||
      !Number.isFinite(cols) ||
      cols <= 0 ||
      !Number.isFinite(rows) ||
      rows <= 0
    )
      return;
    if (!ownsSession(e, id)) return; // PB-H6
    sessions.get(id)?.resize(cols, rows);
  });

  ipcMain.on("pty:kill", (e, id: unknown) => {
    if (typeof id !== "string") return;
    if (!ownsSession(e, id)) return; // PB-H6
    sessions.get(id)?.kill();
    // onExit cleanup (sessions.delete + pty:exit notify) already wired in pty:create.
  });
}

export function killAllSessions(): void {
  for (const s of sessions.values()) s.kill();
  sessions.clear();
  ptyBuffers.clear();
  sessionWindows.clear();
  sessionRoots.clear();
}

// Resolve EVERY vaulted secret value (any could appear in terminal output) so
// the tail/preview can be redacted. Delegates to the broker's named gather.
async function allVaultedValues(root: string): Promise<string[]> {
  return (await vaultedSecrets(root)).map((s) => s.value);
}

// Scrub a (now-removed) secret value out of EVERY live PTY ring buffer.
// get_terminal_tail redacts against the CURRENTLY vaulted values, so once a
// secret is deleted or rotated its old value would otherwise linger in a buffer
// and be returned to the agent un-redacted. Scrub eagerly on delete/rotate
// (redactSecrets also catches the value's encoded forms). Over-scrubbing other
// windows' buffers is harmless and the safe direction. (audit PB-H4)
function scrubSecretFromBuffers(value: string): void {
  if (!value) return;
  for (const [id, raw] of ptyBuffers) {
    const scrubbed = redactSecrets(raw, [value]);
    if (scrubbed !== raw) ptyBuffers.set(id, scrubbed);
  }
}

// Write agent-supplied input bytes to a live pty (the send_terminal_input MCP
// tool, gated by a user grant in agent-requests). Returns false if the session
// is gone. Same write path the pty:input IPC handler uses.
export function writeTerminalInput(ptyId: string, data: string): boolean {
  const s = sessions.get(ptyId);
  if (!s) return false;
  s.write(data);
  return true;
}

// A short human label for the grant modal: the owning project's folder name (or
// "a terminal" when the pty has no recorded root, e.g. a blank-tab shell).
// Returns null if the pty id is unknown, so the tool can report "no such
// terminal". Value-free -- a path basename, never a secret.
export function terminalLabel(ptyId: string): string | null {
  if (!sessions.has(ptyId)) return null;
  const root = sessionRoots.get(ptyId);
  return root ? (root.split("/").pop() ?? root) : "a terminal";
}

// The redacted tail of one terminal's recent output. Root-gated + audited
// (ids/counts only -- never the content). The MCP tool calls THIS (not
// getSecretValue), so the tools.ts source-guard stays green.
export async function getTerminalTail(
  termId: string,
  lines: number,
): Promise<{ tail: string } | { error: string }> {
  const root = lastFocusedRoot();
  if (!root) return { error: "No workspace open" };
  // Scope to the ACTIVE tab: a terminal is the agent's iff it was spawned under
  // the now-active project's root (sessionRoots === lastFocusedRoot, kept current
  // by switchTab -> workspace:setActive). The window filter is kept too -- it
  // composes cleanly since the active tab lives in the focused window -- but the
  // root filter is the precise one for tabs (many projects share one window).
  const winId = lastFocusedWindowId();
  if (winId !== null && sessionWindows.get(termId) !== winId) {
    return { error: "No such terminal" };
  }
  if (sessionRoots.get(termId) !== root) {
    return { error: "No such terminal" };
  }
  const raw = ptyBuffers.get(termId);
  if (raw === undefined) return { error: "No such terminal" };
  const n = Math.min(
    MAX_TAIL_LINES,
    Math.max(1, Math.floor(lines) || DEFAULT_TAIL_LINES),
  );
  const values = await allVaultedValues(root);
  const tail = redactedTail(raw, values, n);
  await appendAudit(root, "agent", "terminal.read", {
    termId,
    lines: n,
  });
  return { tail };
}

// List live terminals with a short redacted content preview so the agent can
// tell them apart (dev-server logs vs idle shell) and pick an id.
export async function listTerminals(): Promise<
  { id: string; preview: string }[]
> {
  const root = lastFocusedRoot();
  const winId = lastFocusedWindowId();
  const values = root ? await allVaultedValues(root) : [];
  const out: { id: string; preview: string }[] = [];
  for (const id of sessions.keys()) {
    // Same dual filter as getTerminalTail: window (kept, composes cleanly) plus
    // the precise active-tab root filter so the agent lists ONLY the terminals
    // of the project whose tab is active (sessionRoots === lastFocusedRoot).
    if (winId !== null && sessionWindows.get(id) !== winId) continue;
    if (sessionRoots.get(id) !== root) continue;
    const raw = ptyBuffers.get(id) ?? "";
    out.push({ id, preview: redactedPreview(raw, values, PREVIEW_LINES) });
  }
  return out;
}
