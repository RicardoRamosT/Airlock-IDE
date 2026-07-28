import { execFile, spawnSync } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  appendAudit,
  buildExtensionSummaries,
  CONNECTED_EXTENSIONS,
  type ConnectedStatus,
  connectedSummary,
  createBranch,
  createDir,
  createFile,
  createPtySession,
  type DetectStatus,
  databaseContainers,
  deleteSecret,
  detectInstalledTerminals,
  detectStatus,
  detectWithOutput,
  discardChanges,
  dockerStart,
  dockerStop,
  duplicate,
  type EventFilter,
  type ExtensionSummary,
  enabledManifests,
  ensureAirlockDir,
  filterDangerousEnv,
  getGlobalSecret,
  getSecretValue,
  ghAccounts,
  gitFetch,
  gitFileVersions,
  gitPull,
  gitPush,
  hasResumableClaudeSession,
  INTEGRATIONS,
  importAllDotEnv,
  importExternal,
  injectInto,
  isGitRepo,
  isRelevant,
  launchArgs,
  listBranches,
  listDirectory,
  listFilesRecursive,
  listSecrets,
  listTables,
  mergeSectionExtensions,
  move,
  neonConnectionUri,
  type PtySession,
  parseAccount,
  parseConnString,
  parseWorkspaceInput,
  pingDb,
  pinnedEnabledManifests,
  pollSteady,
  probePort,
  readAudit,
  readDocument,
  readImageDataUrl,
  readOrder,
  readPdfDataUrl,
  readProjectConfig,
  readRows,
  readWorkbook,
  readWorkspaceFile,
  realRunner,
  redactConnStrings,
  redactedPreview,
  redactedTail,
  redactSecrets,
  requestedWorkspaceName,
  resolveWithin,
  runGit,
  SECTION_EXTENSIONS,
  type SteadyCache,
  searchProject,
  sectionExtensionSummaries,
  setGlobalSecret,
  setSecret,
  slackAuthTest,
  slackScopes,
  stageFiles,
  steadyIntegrationFor,
  switchBranch,
  switchGhAccount,
  targetsVault,
  undoLastCommit,
  unstageFiles,
  vaultedSecrets,
  type WorkspaceTarget,
  withActions,
  withDb,
  workspaceMismatch,
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
  type WebContents,
} from "electron";
import type {
  AppPrefs,
  DropTarget,
  MovingTab,
  PtyAdoptResult,
  Section,
  SessionSnapshot,
} from "../shared/ipc";
import { activityStatus, addDismissedActivity } from "./activity";
import { stampAirlockEnv } from "./airlockEnv";
import { getAnthropicStatus } from "./anthropicStatus/watch";
import {
  detectUnmanaged,
  getDevServerState,
  hostUnverifiedServers,
  onPtyExitForDevServer,
  registerDevServer,
  setDevServerCommand,
  startDevServer,
  stopDevServer,
} from "./devserver/manager";
import { reconcileDockStatus } from "./dockstatus/wire";
import { toRendererErrorEvent } from "./eventlog/rendererError";
import { emitEvent, queryEvents } from "./eventlog/wire";
import { runBrokerFlow } from "./extensions/oauth/broker";
import {
  beginDeviceFlow,
  oauthTokenName,
  pollDeviceToken,
} from "./extensions/oauth/device";
import { CONNECTED_PROVIDERS } from "./extensions/provider";
import { eyeOnConnected } from "./extensions/resources";
import { slackAllChannels, slackWorkspace } from "./extensions/slack";
import { localSlackWorkspaces } from "./extensions/slackDesktop";
import { slackDownloadFileTool } from "./extensions/slackFiles";
import {
  slackAvatarsTool,
  slackConnected,
  slackListAllowedChannelsTool,
  slackReadChannelTool,
} from "./extensions/slackTools";
import { slackWorkspacePatch } from "./extensions/slackWorkspace";
import { syncWindowWatchers } from "./fsWatch";
import {
  applyCredentialHelper,
  autoSwitchForFocus,
  ensureIdentityFor,
  resolveFor,
  tokenFor,
} from "./github/account";
import {
  dockerPgDatabases,
  dockerPgReady,
  dockerPgRows,
  dockerPgTables,
  dockerStatus,
  gitStatusFor,
  neonBranches,
  neonDatabases,
  neonOrganizations,
  neonProjects,
  neonStatus,
  renderDeployService,
  renderServiceDeploys,
  renderServiceEnvCompare,
  renderServiceEnvKeys,
  renderServiceEnvReveal,
  renderServicesStatus,
  resolveDevUrl,
  sectionExtensionStatuses,
} from "./ide-state";
import {
  lspCompletion,
  lspDefinition,
  lspDidChange,
  lspDidClose,
  lspDidOpen,
  lspDocumentSymbol,
  lspHover,
  lspReferences,
  onLspDiagnostics,
  syncLspServers,
} from "./lsp/client";
import { ensureProjectScope } from "./mcp/projectScope";
import { getMcpPort } from "./mcp/server";
import { sampleMemory } from "./memory/sample";
import { applyAppMenu, applyDockMenu, changeSectionVisibility } from "./menu";
import {
  addNeonAccount,
  keyForProject,
  listNeonAccounts,
  removeNeonAccount,
  resolveProjectAccountId,
} from "./neon/accounts";
import { gatherProfile } from "./overview/gather";
import { MAX_ENTRIES } from "./overview/journal";
import {
  addNoteEntry,
  deleteNoteEntry,
  readRecentJournal,
  updateNoteEntry,
} from "./overview/journalStore";
import {
  isSectionId,
  loadPrefs,
  publicPrefs,
  RECENT_CAP,
  sanitizeAgentPolicy,
  savePrefs,
} from "./prefs";
import { getQuota, getUsageLedger } from "./quota/watch";
import { reconcileQuotaMeter } from "./quota/wire";
import { reconcileRunSkill } from "./runskill/wire";
import { guardedCommit } from "./secrets/commit";
import { sectionStatuses } from "./sectionStatus";
import { reconcileSelfVerify } from "./selfverify/wire";
import { mergeSnapshots } from "./session/merge";
import { readSession, writeSession } from "./session-store";
import {
  addSlackWorkspace,
  bindSlackWorkspace,
  listSlackWorkspaces,
} from "./slack/accounts";
import { MovingSessions } from "./tabdrag/moving";
import {
  consumeSuppressRestore,
  endTabDrag,
  startTabDrag,
  takePendingAdopt,
} from "./tabdrag/wire";
import { applyUpdate } from "./update/apply";
import { getUpdate } from "./update/check";
import {
  allOpenRoots,
  clearRootForEvent,
  isOpenRoot,
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

// Per-manifest detect-status cache for the Extension Hub list (extensions:list),
// throttled to each manifest's poll.everyMs so opening the Hub view doesn't
// re-spawn every CLI on each poll tick. Persisted across IPC calls.
const extDetectCache: Record<
  string,
  { at: number; status: DetectStatus; account?: string }
> = {};

// Serialize gh account auto-switches: rapid project-focus changes must not spawn
// concurrent `gh auth switch` subprocesses that complete OUT OF ORDER and leave
// the wrong account active. In-order execution => the last-focused project's
// switch is applied last (wins). Same read-modify-write hazard the quota
// reconcile chain guards.
let ghAutoSwitchChain: Promise<void> = Promise.resolve();

// Per-PTY owning window (sessionId -> BrowserWindow id). Terminal-reading agent
// tools are scoped to the agent's (last-focused) window, so a window only ever
// sees + reads its OWN terminals. Recorded in pty:create, deleted on exit.
const sessionWindows = new Map<string, number>();

// Per-PTY owning project root (sessionId -> workspace root). One tabbed window
// holds many projects' terminals at once. Each MCP session's terminal tools
// receive the calling session's root (resolved from the URL path token) and
// filter by sessionRoots.get(id) === root. Recorded in pty:create (from the
// PANE root the renderer passes at spawn; blank tabs have none and are never
// agent-visible), deleted on exit / killAllSessions.
const sessionRoots = new Map<string, string>();

// Per-PTY ring buffer of recent raw output (tee'd from onData). Bounded so it
// cannot grow unbounded; read (redacted) by get_terminal_tail. Deleted on exit.
const ptyBuffers = new Map<string, string>();

// Per-PTY output target (sessionId -> the WebContents receiving pty:data). Read
// per chunk rather than captured at spawn, so a session can be RE-POINTED to a
// different window when its tab is torn off / merged (see pty:adopt). Deleted on
// exit.
const sessionTargets = new Map<string, WebContents>();

// Single-use adopt tickets for sessions currently moving between windows. Gates
// pty:adopt so no window can adopt an arbitrary pty by guessing an id.
const movingSessions = new MovingSessions();
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

// Fire-and-forget audit of a user-initiated UI action (git op, file op,
// integration change). Serialized internally (withAppendLock) so the unawaited
// write can't fork the hash chain; the Audit panel polls to surface it. Never
// blocks or fails the action it records. Call it only AFTER the action succeeds.
function auditUser(
  root: string,
  op: string,
  detail: Record<string, unknown> = {},
): void {
  void appendAudit(root, "user", op, detail).catch(() => {});
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

// The workspace/account label for a connected extension row, read from its
// per-project config (e.g. Slack's captured workspace name). Undefined -> none.
function workspaceAccountName(cfg: unknown): string | undefined {
  const w =
    cfg && typeof cfg === "object"
      ? (cfg as { workspace?: unknown }).workspace
      : undefined;
  const n =
    w && typeof w === "object" ? (w as { name?: unknown }).name : undefined;
  return typeof n === "string" && n ? n : undefined;
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

// A project's extension config changed on disk (channel allow-list saved, a
// connect recording its workspace, a disconnect). Sections that render that
// config only loaded it on mount, so a connect or a channel pick sat invisible
// until the user hit Refresh. Broadcast to ALL windows, not just the caller: the
// same project can be open in another window, and the config is per-project, not
// per-window. Carries the root only -- no config values, no token.
export function broadcastExtensionsChanged(root: string): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.webContents.isDestroyed())
      w.webContents.send("extensions:changed", { root });
  }
}

const RENDER_KEY = "RENDER_API_KEY";

// MAIN-ONLY: resolve a Neon branch/db connection URI (carries a password) using
// the project's bound account key. NEVER returned over IPC -- only fed to withDb.
async function neonUri(
  root: string | null,
  p: string,
  b: string,
  db: string,
  role: string,
): Promise<string> {
  const key = await keyForProject(root);
  if (!key) throw new Error("No Neon account selected for this project");
  return neonConnectionUri(key, p, b, db, role);
}
const allStr = (xs: unknown[]): boolean =>
  xs.every((x) => typeof x === "string");

// Path to the layout snapshot, alongside prefs.json in userData.
const sessionFile = () => path.join(app.getPath("userData"), "session.json");

// The MERGED snapshot last persisted, kept for the synchronous quit flush.
let latestSnapshot: SessionSnapshot | null = null;
// Per-window layout snapshots (BrowserWindow.id -> its own tabs). Persisting the
// union is what stops a second window from erasing the first's tabs; see
// session/merge.ts.
const windowSnapshots = new Map<number, SessionSnapshot>();

// Synchronous best-effort flush of the latest snapshot, for app before-quit
// (async writes may not finish before the process exits). Writes atomically
// (temp file + renameSync) to match the async writeNow discipline, so a crash
// mid-write can't leave a torn session.json. Single-threaded at quit, so a
// fixed temp path is safe.
export function flushSession(): void {
  if (!latestSnapshot) return;
  try {
    const file = sessionFile();
    const tmp = `${file}.flush.tmp`;
    writeFileSync(tmp, `${JSON.stringify(latestSnapshot, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(tmp, file);
  } catch (err) {
    console.error("[airlock] session flush failed", err);
  }
}

const EVENT_LEVELS = ["debug", "info", "warn", "error"];

// The renderer is untrusted: keep only known fields with valid shapes.
export function sanitizeEventFilter(raw: unknown): EventFilter {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: EventFilter = {};
  if (typeof r.level === "string" && EVENT_LEVELS.includes(r.level))
    out.level = r.level as EventFilter["level"];
  if (typeof r.category === "string") out.category = r.category;
  if (typeof r.op === "string") out.op = r.op;
  if (typeof r.project === "string") out.project = r.project;
  if (typeof r.since === "string") out.since = r.since;
  if (typeof r.limit === "number" && Number.isFinite(r.limit) && r.limit > 0)
    out.limit = Math.floor(r.limit);
  return out;
}

// getBaseEnv supplies the login-shell env captured once at startup (real
// PATH, locale). pty:create uses it as the base for every terminal. Passed
// as an accessor so the latest captured value is read at spawn time and
// ipc.ts holds no module-level mutable state.
//
// The Extension Hub inventory, shared with the MCP extension_status tool.
// listExtensions closes over registerIpc's prefs path and poll cache, so it is
// published here rather than re-implemented; empty until registerIpc has run.
let listExtensionsImpl:
  | ((root: string | null) => Promise<ExtensionSummary[]>)
  | null = null;

export function listExtensionsForAgent(
  root: string | null,
): Promise<ExtensionSummary[]> {
  return listExtensionsImpl ? listExtensionsImpl(root) : Promise.resolve([]);
}

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

  // True iff an absolute path is an existing DIRECTORY. Renderer-only (session
  // restore skips saved project roots that vanished); NOT an MCP/agent tool.
  // The arg is an absolute path from our own session.json -- no relPath join,
  // so no path-traversal vector. Never throws.
  ipcMain.handle("fs:dirExists", async (_e, p: unknown) => {
    if (typeof p !== "string") return false;
    try {
      return (await stat(p)).isDirectory();
    } catch {
      return false;
    }
  });

  ipcMain.handle("claude:hasResumableSession", (_e, root: unknown) => {
    if (typeof root !== "string") throw new Error("Invalid payload");
    return hasResumableClaudeSession(root);
  });

  ipcMain.handle("overview:get", async (e, root: unknown) => {
    if (typeof root !== "string" || !isOpenRoot(e, root))
      throw new Error("Invalid or unopened root");
    // Drop the vault .gitignore before the Overview can prompt Claude to write
    // .airlock/overview.md, so the generated file (and the whole vault) can never
    // be accidentally committed in a project that has not yet triggered a
    // secret/audit write. Idempotent + best-effort (never blocks the gather).
    await ensureAirlockDir(root).catch(() => {});
    return gatherProfile(root);
  });
  // The project's Changelog journal (newest-first) for the Overview page. Send
  // the full capped set so the Notes tab + search see every entry.
  ipcMain.handle("journal:get", async (e, root: unknown) => {
    if (typeof root !== "string" || !isOpenRoot(e, root)) return [];
    return readRecentJournal(root, MAX_ENTRIES);
  });
  const broadcastJournalChanged = (root: string) => {
    for (const w of BrowserWindow.getAllWindows())
      if (!w.webContents.isDestroyed())
        w.webContents.send("journal:changed", { root });
  };
  ipcMain.handle(
    "journal:addNote",
    async (e, root: unknown, text: unknown, details: unknown) => {
      if (typeof root !== "string" || !isOpenRoot(e, root))
        return { ok: false, error: "No access" };
      const r = await addNoteEntry(root, text, details, Date.now());
      if (r.ok) broadcastJournalChanged(root);
      return r;
    },
  );
  ipcMain.handle(
    "journal:updateNote",
    async (e, root: unknown, ts: unknown, text: unknown, details: unknown) => {
      if (typeof root !== "string" || !isOpenRoot(e, root))
        return { ok: false, error: "No access" };
      if (typeof ts !== "number") return { ok: false, error: "Bad ts" };
      const r = await updateNoteEntry(root, ts, text, details);
      if (r.ok) broadcastJournalChanged(root);
      return r;
    },
  );
  ipcMain.handle(
    "journal:deleteNote",
    async (e, root: unknown, ts: unknown) => {
      if (typeof root !== "string" || !isOpenRoot(e, root))
        return { ok: false, error: "No access" };
      if (typeof ts !== "number") return { ok: false, error: "Bad ts" };
      const r = await deleteNoteEntry(root, ts);
      if (r.ok) broadcastJournalChanged(root);
      return r;
    },
  );

  ipcMain.handle("fs:readImage", (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    return readImageDataUrl(resolveRoot(e, root), relPath);
  });
  ipcMain.handle("fs:readPdf", (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    return readPdfDataUrl(resolveRoot(e, root), relPath);
  });
  ipcMain.handle("fs:readExcel", (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    return readWorkbook(resolveRoot(e, root), relPath);
  });
  ipcMain.handle("fs:readDocx", (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    return readDocument(resolveRoot(e, root), relPath);
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

  ipcMain.handle("fs:create", async (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    const resolved = resolveRoot(e, root);
    const r = await createFile(resolved, relPath);
    auditUser(resolved, "file.create", { path: relPath });
    return r;
  });
  ipcMain.handle("fs:mkdir", async (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    const resolved = resolveRoot(e, root);
    const r = await createDir(resolved, relPath);
    auditUser(resolved, "folder.create", { path: relPath });
    return r;
  });
  ipcMain.handle(
    "fs:move",
    async (e, root: unknown, fromRel: unknown, toRel: unknown) => {
      if (typeof fromRel !== "string" || typeof toRel !== "string")
        throw new Error("Invalid payload");
      assertNotVault(fromRel);
      assertNotVault(toRel);
      const resolved = resolveRoot(e, root);
      const r = await move(resolved, fromRel, toRel);
      auditUser(resolved, "file.move", { from: fromRel, to: toRel });
      return r;
    },
  );
  ipcMain.handle("fs:duplicate", async (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    const resolved = resolveRoot(e, root);
    const r = await duplicate(resolved, relPath);
    auditUser(resolved, "file.duplicate", { path: relPath });
    return r;
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
    const resolved = resolveRoot(e, root);
    // resolveWithin returns the absolute, root-confined path for shell.trashItem.
    const abs = await resolveWithin(resolved, relPath);
    await shell.trashItem(abs);
    auditUser(resolved, "file.delete", { path: relPath });
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
  ipcMain.handle("lsp:documentSymbol", (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    return lspDocumentSymbol(resolveRoot(e, root), relPath);
  });

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
  // installSalt is stripped before sending to the renderer -- it is main-only
  // (used for per-project token derivation) and the renderer never needs it.
  ipcMain.handle("prefs:get", async () => {
    const prefs = await loadPrefs(prefsFile);
    return publicPrefs(prefs);
  });

  ipcMain.handle("quota:get", () => getQuota());
  ipcMain.handle("anthropicStatus:get", () => getAnthropicStatus());
  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    mcpPort: getMcpPort(),
  }));
  ipcMain.handle("update:get", () => getUpdate());
  ipcMain.handle("update:apply", () => applyUpdate());

  // usage:get -> SessionUsage[] for the Usage dashboard (sorted by output
  // tokens, the cost proxy on subscription plans).
  ipcMain.handle("usage:get", () => getUsageLedger());

  // memory:get -> MemorySample for the Usage dashboard Memory panel. On demand
  // (the dashboard polls while open); samples AirLock's process tree footprint.
  ipcMain.handle("memory:get", () => sampleMemory());

  // Session restore: read the persisted layout snapshot; save the latest one
  // (async, serialized, best-effort) and hold it for the synchronous quit flush.
  // App-global (NOT root-gated). Value-free: roots + booleans only.
  // A window created to receive a torn-off tab must NOT restore: the snapshot is
  // app-global, so restoring would reopen EVERY project in a window that should
  // hold only the dragged one. Single-use, so a later reload restores normally.
  ipcMain.handle("session:get", (e) => {
    const id = BrowserWindow.fromWebContents(e.sender)?.id;
    if (id !== undefined && consumeSuppressRestore(id)) return null;
    return readSession(sessionFile());
  });
  // Renderer-reported errors (window.onerror / unhandledrejection) -> the event
  // log, so read_events surfaces frontend crashes too. Fire-and-forget.
  ipcMain.on("events:report", (_e, p: unknown) => {
    if (!p || typeof p !== "object") return;
    const r = p as Record<string, unknown>;
    const kind =
      r.kind === "unhandledrejection" ? "unhandledrejection" : "error";
    emitEvent(
      toRendererErrorEvent({
        kind,
        message: typeof r.message === "string" ? r.message : "unknown error",
        source: typeof r.source === "string" ? r.source : undefined,
        line: typeof r.line === "number" ? r.line : undefined,
        col: typeof r.col === "number" ? r.col : undefined,
        stack: typeof r.stack === "string" ? r.stack : undefined,
      }),
    );
  });
  // Each renderer reports only ITS OWN tabs, so with two windows open (routine
  // now that a tab can be torn off) keeping just the last report meant the second
  // window clobbered the first's tab list and those projects were gone after a
  // restart. Keep them per window and persist the UNION of the live ones.
  ipcMain.on("session:save", (e, snap: SessionSnapshot) => {
    const id = BrowserWindow.fromWebContents(e.sender)?.id;
    if (id === undefined) return;
    windowSnapshots.set(id, snap);
    // Drop windows that have since closed, so their tabs stop being restored.
    const alive = new Set(
      BrowserWindow.getAllWindows()
        .filter((w) => !w.isDestroyed())
        .map((w) => w.id),
    );
    for (const key of windowSnapshots.keys())
      if (!alive.has(key)) windowSnapshots.delete(key);
    const merged = mergeSnapshots(
      [...windowSnapshots].map(([wid, s]) => ({ id: wid, snap: s })),
      lastFocusedWindowId(),
    );
    if (!merged) return;
    latestSnapshot = merged; // held for the synchronous quit flush
    void writeSession(sessionFile(), merged); // async, serialized, best-effort
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
    if ("dockStatus" in (patch as object)) {
      const p = await loadPrefs(prefsFile);
      await reconcileDockStatus(p.dockStatus.enabled).catch((e) =>
        console.warn("[airlock] dock status reconcile failed", e),
      );
    }
    if ("runAppSkill" in (patch as object)) {
      const p = await loadPrefs(prefsFile);
      await reconcileRunSkill(p.runAppSkill.enabled).catch((e) =>
        console.warn("[airlock] run-app skill reconcile failed", e),
      );
    }
    if ("selfVerify" in (patch as object)) {
      const p = await loadPrefs(prefsFile);
      await reconcileSelfVerify(p.selfVerify.enabled).catch((e) =>
        console.warn("[airlock] self-verify skill reconcile failed", e),
      );
    }
    return publicPrefs(saved);
  });

  // App-global (NOT requireRoot-gated): toggle a sidebar section's visibility.
  // Funnels through changeSectionVisibility, which persists the full map,
  // rebuilds the menu, and pushes "sections:changed" to the renderer.
  ipcMain.handle("sections:set", (_e, id: unknown, visible: unknown) => {
    if (
      typeof id !== "string" ||
      !isSectionId(id) ||
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

  ipcMain.handle("events:query", (_e, filter: unknown) =>
    queryEvents(sanitizeEventFilter(filter)),
  );

  ipcMain.handle("git:isRepo", (e, root: unknown) =>
    isGitRepo(resolveRoot(e, root)),
  );

  ipcMain.handle("git:status", (e, root: unknown) =>
    gitStatusFor(resolveRoot(e, root)),
  );

  ipcMain.handle("git:stage", async (e, root: unknown, paths: unknown) => {
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== "string")) {
      throw new Error("Invalid payload");
    }
    const resolved = resolveRoot(e, root);
    await stageFiles(resolved, paths as string[]);
    auditUser(resolved, "git.stage", { count: paths.length });
  });

  ipcMain.handle("git:unstage", async (e, root: unknown, paths: unknown) => {
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== "string")) {
      throw new Error("Invalid payload");
    }
    const resolved = resolveRoot(e, root);
    await unstageFiles(resolved, paths as string[]);
    auditUser(resolved, "git.unstage", { count: paths.length });
  });

  ipcMain.handle("git:commit", async (e, root: unknown, message: unknown) => {
    if (typeof message !== "string") throw new Error("Invalid payload");
    const resolved = resolveRoot(e, root);
    await ensureIdentityFor(resolved); // author commits as the project's account
    return guardedCommit(resolved, message, { gated: false });
  });

  ipcMain.handle(
    "git:discard",
    async (e, root: unknown, paths: unknown, untracked: unknown) => {
      if (
        !Array.isArray(paths) ||
        paths.some((p) => typeof p !== "string") ||
        typeof untracked !== "boolean"
      ) {
        throw new Error("Invalid payload");
      }
      const resolved = resolveRoot(e, root);
      await discardChanges(resolved, paths as string[], untracked);
      auditUser(resolved, "git.discard", { paths, untracked });
    },
  );

  ipcMain.handle("git:uncommit", async (e, root: unknown) => {
    const resolved = resolveRoot(e, root);
    await undoLastCommit(resolved);
    auditUser(resolved, "git.uncommit", {});
  });

  ipcMain.handle("git:branches", (e, root: unknown) =>
    listBranches(resolveRoot(e, root)),
  );

  ipcMain.handle("git:fetch", async (e, root: unknown) => {
    const resolved = resolveRoot(e, root);
    const r = await gitFetch(resolved, await tokenFor(resolved));
    auditUser(resolved, "git.fetch", {});
    return r;
  });
  ipcMain.handle("git:pull", async (e, root: unknown) => {
    const resolved = resolveRoot(e, root);
    const r = await gitPull(resolved, await tokenFor(resolved));
    auditUser(resolved, "git.pull", {});
    return r;
  });
  ipcMain.handle("git:push", async (e, root: unknown) => {
    const resolved = resolveRoot(e, root);
    const r = await gitPush(resolved, await tokenFor(resolved));
    auditUser(resolved, "git.push", {});
    return r;
  });

  ipcMain.handle(
    "git:switchBranch",
    async (e, root: unknown, name: unknown) => {
      if (typeof name !== "string") throw new Error("Invalid payload");
      const resolved = resolveRoot(e, root);
      await switchBranch(resolved, name);
      auditUser(resolved, "git.branch.switch", { to: name });
    },
  );

  ipcMain.handle(
    "git:createBranch",
    async (e, root: unknown, name: unknown) => {
      if (typeof name !== "string") throw new Error("Invalid payload");
      const resolved = resolveRoot(e, root);
      await createBranch(resolved, name);
      auditUser(resolved, "git.branch.create", { name });
    },
  );

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
      await applyCredentialHelper(resolved, acct ?? null); // pin/unpin the push credential
    },
  );

  // Fired by the renderer when the focused project changes. Best-effort global
  // gh account switch for NON-PINNED projects, gated by the githubAutoSwitch
  // pref. Pinned projects are untouched (they carry their own credential helper).
  ipcMain.handle("github:autoSwitchOnFocus", (e, root: unknown) => {
    const resolved = resolveRoot(e, root);
    // Chain onto the prior switch so they run one at a time, in focus order.
    const run = ghAutoSwitchChain.then(async () => {
      const prefs = await loadPrefs(prefsFile);
      await autoSwitchForFocus(resolved, prefs.githubAutoSwitch);
    });
    // Non-rejecting tail so one failed switch can't wedge the queue.
    ghAutoSwitchChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  });

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
    const startedAt = Date.now();
    try {
      const resolved = resolveRoot(e, root);
      const connStr = await dbConnString(resolved, id);
      // Parse host/database identifiers BEFORE connecting (identifier-only, no password).
      const info = parseConnString(connStr);
      await withDb(connStr, (run) => pingDb(run));
      emitEvent({
        level: "info",
        category: "db",
        op: "db.ping",
        outcome: "ok",
        durationMs: Date.now() - startedAt,
        detail: { id, host: info?.host ?? "", database: info?.database ?? "" },
      });
      return { ok: true };
    } catch (err) {
      emitEvent({
        level: "error",
        category: "db",
        op: "db.ping",
        outcome: "error",
        durationMs: Date.now() - startedAt,
        detail: { id },
        error: { message: err instanceof Error ? err.message : String(err) },
      });
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

  // Docker Postgres explorer. Addressed by CONTAINER ID: the connection URL is
  // built main-side from the container's env and never crosses IPC, so the
  // renderer has no way to name a database except through the container that
  // owns it. Errors are message-only and redacted, matching db:tables below --
  // a raw pg error can carry the connection string.
  ipcMain.handle("dockerPg:ready", async (_e, id: unknown) => {
    if (typeof id !== "string") throw new Error("Invalid payload");
    return await dockerPgReady(id);
  });
  ipcMain.handle("dockerPg:databases", async (_e, id: unknown) => {
    if (typeof id !== "string") throw new Error("Invalid payload");
    try {
      return await dockerPgDatabases(id);
    } catch (err) {
      throw new Error(
        redactConnStrings(err instanceof Error ? err.message : String(err)),
      );
    }
  });
  ipcMain.handle(
    "dockerPg:tables",
    async (_e, id: unknown, database: unknown) => {
      if (typeof id !== "string" || typeof database !== "string")
        throw new Error("Invalid payload");
      try {
        return await dockerPgTables(id, database);
      } catch (err) {
        throw new Error(
          redactConnStrings(err instanceof Error ? err.message : String(err)),
        );
      }
    },
  );
  ipcMain.handle(
    "dockerPg:rows",
    async (
      _e,
      id: unknown,
      database: unknown,
      schema: unknown,
      table: unknown,
      limit: unknown,
    ) => {
      if (
        typeof id !== "string" ||
        typeof database !== "string" ||
        typeof schema !== "string" ||
        typeof table !== "string"
      )
        throw new Error("Invalid payload");
      try {
        return await dockerPgRows(
          id,
          database,
          schema,
          table,
          typeof limit === "number" ? limit : 100,
        );
      } catch (err) {
        throw new Error(
          redactConnStrings(err instanceof Error ? err.message : String(err)),
        );
      }
    },
  );

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
  // Multi-account Neon. The pool (id+label only) and the per-project binding are
  // app-global/config; the keys stay main-only. Data reads resolve the FOCUSED
  // project's account via rootForEvent, so each project shows only its account.
  ipcMain.handle("neon:status", (e) => neonStatus(rootForEvent(e)));
  ipcMain.handle("neon:accounts", () => listNeonAccounts());
  ipcMain.handle("neon:resolveAccount", async (e) => {
    const id = await resolveProjectAccountId(rootForEvent(e));
    if (!id) return null;
    return (await listNeonAccounts()).find((a) => a.id === id) ?? null;
  });
  // Add a key to the pool AND bind it to the focused project.
  ipcMain.handle("neon:addAccount", async (e, key: unknown) => {
    if (typeof key !== "string" || !key.trim())
      throw new Error("Invalid payload");
    const ref = await addNeonAccount(key.trim());
    const root = rootForEvent(e);
    if (root) {
      await writeProjectConfig(root, { neonAccountId: ref.id });
      auditUser(root, "neon.account.add", { label: ref.label });
    }
    return ref;
  });
  // Bind the focused project to an already-connected account.
  ipcMain.handle("neon:setProjectAccount", async (e, id: unknown) => {
    if (typeof id !== "string" || !id) throw new Error("Invalid payload");
    const root = requireRoot(e);
    await writeProjectConfig(root, { neonAccountId: id });
    const label = (await listNeonAccounts()).find((a) => a.id === id)?.label;
    auditUser(root, "neon.account.bind", { label: label ?? id });
  });
  // Remove an account from the pool entirely (clears its key). Projects bound to
  // it fall back to the picker (resolve returns null).
  ipcMain.handle("neon:removeAccount", async (e, id: unknown) => {
    if (typeof id !== "string" || !id) throw new Error("Invalid payload");
    const label = (await listNeonAccounts()).find((a) => a.id === id)?.label;
    await removeNeonAccount(id);
    const root = rootForEvent(e);
    if (root) auditUser(root, "neon.account.remove", { label: label ?? id });
  });
  ipcMain.handle("neon:orgs", (e) => neonOrganizations(rootForEvent(e)));
  ipcMain.handle("neon:projects", (e, orgId: unknown) => {
    if (typeof orgId !== "string") throw new Error("Invalid payload");
    return neonProjects(rootForEvent(e), orgId);
  });
  ipcMain.handle("neon:branches", (e, p: unknown) => {
    if (typeof p !== "string") throw new Error("Invalid payload");
    return neonBranches(rootForEvent(e), p);
  });
  ipcMain.handle("neon:databases", (e, p: unknown, b: unknown) => {
    if (!allStr([p, b])) throw new Error("Invalid payload");
    return neonDatabases(rootForEvent(e), p as string, b as string);
  });
  ipcMain.handle("neon:ping", async (e, p, b, db, role) => {
    if (!allStr([p, b, db, role])) throw new Error("Invalid payload");
    const startedAt = Date.now();
    try {
      await withDb(await neonUri(rootForEvent(e), p, b, db, role), (run) =>
        pingDb(run),
      );
      emitEvent({
        level: "info",
        category: "neon",
        op: "neon.ping",
        outcome: "ok",
        durationMs: Date.now() - startedAt,
        // p = neon project id, b = branch id, db = database name: identifiers only
        detail: { project: p, branch: b, database: db },
      });
      return { ok: true };
    } catch (err) {
      emitEvent({
        level: "error",
        category: "neon",
        op: "neon.ping",
        outcome: "error",
        durationMs: Date.now() - startedAt,
        detail: { project: p, branch: b, database: db },
        error: { message: err instanceof Error ? err.message : String(err) },
      });
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
  ipcMain.handle("neon:tables", async (e, p, b, db, role) => {
    if (!allStr([p, b, db, role])) throw new Error("Invalid payload");
    try {
      return await withDb(
        await neonUri(rootForEvent(e), p, b, db, role),
        (run) => listTables(run),
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
    async (e, p, b, db, role, schema, table, limit) => {
      if (!allStr([p, b, db, role, schema, table]))
        throw new Error("Invalid payload");
      const lim = typeof limit === "number" ? limit : 100;
      try {
        return await withDb(
          await neonUri(rootForEvent(e), p, b, db, role),
          (run) => readRows(run, schema as string, table as string, lim),
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
  ipcMain.handle("render:connect", async (e, key: unknown) => {
    if (typeof key !== "string" || !key.trim())
      throw new Error("Invalid payload");
    await setGlobalSecret(RENDER_KEY, key.trim(), { auditLog: globalAuditLog });
    const root = rootForEvent(e);
    if (root) auditUser(root, "render.connect", {});
    return { connected: true };
  });
  ipcMain.handle("render:services", async (e) => {
    const startedAt = Date.now();
    try {
      const result = await renderServicesStatus(rootForEvent(e));
      emitEvent({
        level: "info",
        category: "render",
        op: "render.listServices",
        outcome: "ok",
        durationMs: Date.now() - startedAt,
        // count of service ids returned (identifiers, not values)
        detail: { count: result.length },
      });
      return result;
    } catch (err) {
      emitEvent({
        level: "error",
        category: "render",
        op: "render.listServices",
        outcome: "error",
        durationMs: Date.now() - startedAt,
        error: { message: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  });
  ipcMain.handle("render:deploys", (_e, serviceId: unknown) => {
    if (typeof serviceId !== "string" || !serviceId)
      throw new Error("Invalid payload");
    return renderServiceDeploys(serviceId);
  });
  ipcMain.handle("render:deploy", async (e, serviceId: unknown) => {
    if (typeof serviceId !== "string" || !serviceId)
      throw new Error("Invalid payload");
    await renderDeployService(serviceId);
    const root = rootForEvent(e);
    if (root) auditUser(root, "render.deploy", { service: serviceId });
  });
  ipcMain.handle("render:envKeys", async (_e, serviceId: unknown) => {
    if (typeof serviceId !== "string" || !serviceId)
      throw new Error("Invalid payload");
    const startedAt = Date.now();
    const keys = await renderServiceEnvKeys(serviceId);
    emitEvent({
      level: "info",
      category: "render",
      op: "render.envKeys",
      outcome: "ok",
      durationMs: Date.now() - startedAt,
      detail: { service: serviceId, count: keys.length }, // identifiers only
    });
    return keys;
  });
  // OWNER-ONLY value path. The renderer is the human's surface; the agent (over
  // MCP) cannot call this IPC and is given no env-var tool. Audited (service +
  // key only — never the value).
  ipcMain.handle(
    "render:envReveal",
    async (e, serviceId: unknown, key: unknown) => {
      if (typeof serviceId !== "string" || !serviceId)
        throw new Error("Invalid payload");
      if (typeof key !== "string" || !key) throw new Error("Invalid payload");
      const root = rootForEvent(e);
      if (root)
        auditUser(root, "render.env.reveal", { service: serviceId, key });
      return renderServiceEnvReveal(serviceId, key);
    },
  );
  ipcMain.handle("render:envCompare", async (_e, a: unknown, b: unknown) => {
    if (typeof a !== "string" || !a || typeof b !== "string" || !b)
      throw new Error("Invalid payload");
    return renderServiceEnvCompare(a, b);
  });

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
    const startedAt = Date.now();
    const up = await probePort(u.hostname, port);
    emitEvent({
      level: "info",
      category: "host",
      op: "host.probe",
      outcome: up ? "ok" : "error",
      durationMs: Date.now() - startedAt,
      // hostname + port are connection identifiers, not secret values
      detail: { hostname: u.hostname, port, up },
    });
    return { up };
  });
  // Validate http(s) BEFORE opening: never file:// or a custom scheme.
  ipcMain.handle("host:openExternal", (_e, url: unknown) => {
    if (typeof url !== "string" || !/^https?:\/\//.test(url))
      throw new Error("Invalid payload");
    return shell.openExternal(url);
  });

  // Managed dev server: lifecycle handlers. Root-gated via resolveRoot.
  ipcMain.handle("devserver:status", (e, root: unknown) =>
    getDevServerState(resolveRoot(e, root)),
  );
  ipcMain.handle("devserver:start", (e, root: unknown) =>
    startDevServer(resolveRoot(e, root), "user"),
  );
  ipcMain.handle(
    "devserver:setCommand",
    (e, root: unknown, command: unknown) => {
      if (typeof command !== "string") throw new Error("Invalid payload");
      return setDevServerCommand(resolveRoot(e, root), command);
    },
  );
  ipcMain.handle("devserver:stop", (e, root: unknown) => {
    const resolved = resolveRoot(e, root);
    auditUser(resolved, "host.devserver.stop", {});
    return stopDevServer(resolved);
  });
  ipcMain.handle(
    "devserver:register",
    (
      e,
      root: unknown,
      terminalId: unknown,
      ptyId: unknown,
      command: unknown,
      startedBy: unknown,
    ) => {
      if (
        typeof terminalId !== "string" ||
        typeof ptyId !== "string" ||
        typeof command !== "string" ||
        (startedBy !== "user" && startedBy !== "agent")
      )
        throw new Error("Invalid payload");
      const resolved = resolveRoot(e, root);
      auditUser(resolved, "host.devserver.start", { startedBy, command });
      return registerDevServer(resolved, terminalId, ptyId, command, startedBy);
    },
  );
  ipcMain.handle("devserver:detectUnmanaged", (e, root: unknown) =>
    detectUnmanaged(resolveRoot(e, root)),
  );
  ipcMain.handle("host:unverifiedServers", (e, root: unknown) =>
    hostUnverifiedServers(resolveRoot(e, root)),
  );

  // Activity-rail status dots: one aggregate read fanning out to docker/db/host/
  // git/activity for the renderer-supplied project root (null = blank tab).
  ipcMain.handle("section:statuses", (_e, root: unknown) => {
    if (root !== null && typeof root !== "string")
      throw new Error("Invalid payload");
    return sectionStatuses(root);
  });

  // Docker: machine-global, so NOT requireRoot-gated.
  ipcMain.handle("docker:list", async () => {
    const startedAt = Date.now();
    try {
      const result = await dockerStatus();
      emitEvent({
        level: "info",
        category: "docker",
        op: "docker.list",
        outcome: "ok",
        durationMs: Date.now() - startedAt,
        // container count + engine state: identifiers/booleans, not values
        detail: {
          count: result.containers.length,
          engineRunning: result.running,
        },
      });
      return result;
    } catch (err) {
      emitEvent({
        level: "error",
        category: "docker",
        op: "docker.list",
        outcome: "error",
        durationMs: Date.now() - startedAt,
        error: { message: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  });

  // activity:status -> ActivityItem[]; NOT requireRoot-gated (render/docker work
  // with no folder; activityStatus skips CI itself when there is no root). The
  // renderer passes the PANE's root explicitly (the one shared sidebar follows
  // the focused pane, and an implicit window root would race the focus sync);
  // validate it like resolveRoot does, degrading to global-only items.
  ipcMain.handle("activity:status", async (e, root?: unknown) => {
    const prefs = await loadPrefs(prefsFile);
    return activityStatus(
      typeof root === "string" && root && isOpenRoot(e, root) ? root : null,
      prefs.extensions ?? {},
    );
  });

  // integrations:steady -> SteadyIntegration[] for the sidebar steady surface.
  // The RESOURCE list is account-wide (a warehouse/web app isn't project-scoped)
  // and cached per manifest, but a manifest may declare `relevance` so its
  // section shows ONLY in projects that use the tool (e.g. Azure only where an
  // AZURE_* secret is vaulted or an azd config exists). So: poll account-wide,
  // then drop irrelevant integrations for the focused project. listSecrets reads
  // names only (no keychain prompt).
  ipcMain.handle("integrations:steady", async (e) => {
    const root = rootForEvent(e);
    // Category views (Host/Databases) show an integration ONLY when the user has
    // pinned it in the Extension Hub -- default is Hub-only, keeping the sidebar
    // clean. (Disabled integrations are excluded too, via pinnedEnabledManifests.)
    const prefs = await loadPrefs(prefsFile);
    const manifests = pinnedEnabledManifests(
      INTEGRATIONS,
      prefs.extensions ?? {},
    );
    const all = await pollSteady(manifests, root, Date.now(), steadyCache);
    if (!root) return all; // no focused project -> nothing to disambiguate
    const secretNames = (await listSecrets(root)).map((m) => m.name);
    let rootFiles: string[] = [];
    try {
      rootFiles = await readdir(root);
    } catch {
      // unreadable root (deleted/permissions): fall back to no file signal
    }
    const byId = new Map(manifests.map((m) => [m.id, m]));
    return all.filter((s) => {
      const m = byId.get(s.id);
      return m ? isRelevant(m, { secretNames, rootFiles }) : true;
    });
  });

  // integrations:resources -> the resources for ONE integration, account-wide,
  // with NO pin/relevance filter (unlike integrations:steady). Powers the
  // Extension Hub's expand-in-place, and (2026-07-27) a manifest's own
  // extension section (ManifestExtensionSection, for Snowflake/Azure) --
  // see & control a connection's resources from any project. Reuses the shared
  // steadyCache (everyMs-throttled) so it never double-spawns a CLI the Host
  // view already polled. Uses steadyIntegrationFor rather than pollSteady
  // SPECIFICALLY so this also works for an Activity-surfaced manifest that
  // contributes no Databases/Host provider row -- pollSteady excludes those,
  // which made this return null and left such an icon a permanent dead end.
  // (No shipped manifest is Activity-surfaced today; engine.test.ts covers the
  // branch with a local fixture.) Returns null only for an unknown id.
  ipcMain.handle("integrations:resources", async (e, id: string) => {
    const root = rootForEvent(e);
    const m = INTEGRATIONS.find((x) => x.id === id);
    if (!m) return null;
    return steadyIntegrationFor(m, root, Date.now(), steadyCache);
  });

  // extensions:list -> ExtensionSummary[] for the Extension Hub view. Detects
  // EVERY manifest (regardless of surface) so the Hub is the one place that lists
  // all integrations, throttled per-id by poll.everyMs, then folds prefs
  // (enabled/pinned). Detect (an auth check) never mutates; a failure degrades to
  // "absent" so a missing/slow CLI never breaks the list.
  // Extracted from the IPC handler so the MCP extension_status tool answers from
  // the SAME inventory the Hub renders -- a second implementation is how the
  // agent's view of what is connected drifts from the user's.
  const listExtensions = async (root: string | null) => {
    const prefs = await loadPrefs(prefsFile);
    const ext = prefs.extensions ?? {};
    const now = Date.now();
    const statuses: Record<string, DetectStatus> = {};
    const accounts: Record<string, string | undefined> = {};
    // Detect only ENABLED manifests (a disabled integration is "not polled" --
    // buildExtensionSummaries reports it as "disabled" regardless of status).
    await Promise.all(
      enabledManifests(INTEGRATIONS, ext).map(async (m) => {
        const cached = extDetectCache[m.id];
        if (cached && now - cached.at < m.poll.everyMs) {
          statuses[m.id] = cached.status;
          accounts[m.id] = cached.account;
          return;
        }
        const cwd = m.poll.cwdScoped ? (root ?? undefined) : undefined;
        const timeoutMs = m.poll.timeoutMs ?? 8000;
        // A manifest that declares `account` uses the stdout-capturing probe so
        // the SAME auth check yields the connected-account label; others only
        // need the status. Both degrade to "absent" on any error.
        if (m.account) {
          const { status, stdout } = await detectWithOutput(
            m,
            cwd,
            timeoutMs,
            realRunner,
          ).catch(() => ({ status: "absent" as DetectStatus, stdout: "" }));
          const account =
            status === "ready"
              ? (parseAccount(stdout, m.account.path) ?? undefined)
              : undefined;
          extDetectCache[m.id] = { at: now, status, account };
          statuses[m.id] = status;
          accounts[m.id] = account;
        } else {
          const status = await detectStatus(
            m,
            cwd,
            timeoutMs,
            realRunner,
          ).catch((): DetectStatus => "absent");
          extDetectCache[m.id] = { at: now, status };
          statuses[m.id] = status;
        }
      }),
    );
    const tier1 = buildExtensionSummaries(
      INTEGRATIONS,
      statuses,
      ext,
      accounts,
    );
    // Tier-2 connected extensions (e.g. Slack): status is per-project (a token
    // vaulted for the focused root). No root -> unauthed (can't check).
    const projExts = root
      ? ((await readProjectConfig(root).catch(() => null))?.extensions ?? null)
      : null;
    const connected = await Promise.all(
      CONNECTED_EXTENSIONS.map(async (d) => {
        const provider = CONNECTED_PROVIDERS[d.id];
        const status: ConnectedStatus =
          root && provider
            ? await provider.status(root).catch((): ConnectedStatus => "error")
            : "unauthed";
        const summary = connectedSummary(d, status, ext);
        const account =
          status === "connected"
            ? workspaceAccountName(projExts?.[d.id])
            : undefined;
        return account ? { ...summary, account } : summary;
      }),
    );
    // Snowflake/Azure are EACH both a tier1 manifest (INTEGRATIONS, above) and
    // a SECTION_EXTENSIONS descriptor -- mergeSectionExtensions dedupes those
    // to one row (the manifest's detect status wins, brand icon kept), so the
    // hub is a complete inventory WITHOUT listing either twice. Neon/Docker/
    // Render have no manifest, so their section rows pass through carrying the
    // status sectionExtensionStatuses just probed for them.
    const rows = [
      ...mergeSectionExtensions(
        tier1,
        sectionExtensionSummaries(
          SECTION_EXTENSIONS,
          ext,
          await sectionExtensionStatuses(root),
        ),
      ),
      ...connected,
    ];
    // withActions (agent-core) attaches each row's actions: the renderer cannot
    // value-import agent-core, so the decision has to ride along with the data.
    return withActions(rows);
  };

  // The workspace pool, for the "reuse an account" buttons. Refs ONLY -- the
  // tokens stay in main, exactly like the Neon key pool.
  ipcMain.handle("slack:workspaces", () => listSlackWorkspaces());
  ipcMain.handle(
    "slack:bindWorkspace",
    async (e, root: unknown, id: unknown) => {
      if (id !== null && typeof id !== "string")
        throw new Error("Invalid payload");
      const r = resolveRoot(e, root);
      if (!r) throw new Error("No workspace open");
      await bindSlackWorkspace(r, id);
      broadcastExtensionsChanged(r);
    },
  );

  ipcMain.handle("extensions:list", (e) => listExtensions(rootForEvent(e)));
  // Hand the same inventory to the MCP layer. registerIpc runs once at startup,
  // well before any per-request MCP server is built, so the holder is always
  // populated by the time a tool can call it.
  listExtensionsImpl = listExtensions;

  // extensions:resources -> for each ENABLED + eye-on (pinned) connected
  // extension, its granted resources tagged with the section its eye targets
  // (`category`). Root-scoped; per-provider errors degrade to []. The renderer's
  // Git/Activity sections filter by category and render each resource row.
  ipcMain.handle("extensions:resources", async (e) => {
    const root = rootForEvent(e);
    if (!root) return [];
    const prefs = await loadPrefs(prefsFile);
    const ext = prefs.extensions ?? {};
    const wanted = eyeOnConnected(CONNECTED_EXTENSIONS, ext);
    const out = await Promise.all(
      wanted.map(async (d) => {
        const provider = CONNECTED_PROVIDERS[d.id];
        const resources = provider
          ? await provider.listResources(root).catch(() => [])
          : [];
        return {
          id: d.id,
          name: d.name,
          category: d.category ?? "",
          resources,
        };
      }),
    );
    return out.filter((r) => r.category);
  });

  // extensions:resourcesFor -> ONE connected extension's granted resources,
  // root-scoped and PIN-INDEPENDENT (unlike extensions:resources). Powers the
  // Extension Hub's expand for Tier-2 rows: Slack -> allow-listed channels,
  // GitHub -> this repo's issues/PRs. [] with no focused project / unknown id /
  // provider error.
  ipcMain.handle("extensions:resourcesFor", async (e, id: string) => {
    const root = rootForEvent(e);
    if (!root) return [];
    const provider = CONNECTED_PROVIDERS[id];
    if (!provider) return [];
    return provider.listResources(root).catch(() => []);
  });

  // Slack sidebar reads go through the SAME gated functions the MCP tools call
  // (slackListAllowedChannelsTool / slackReadChannelTool) -- NOT a parallel
  // path. That is what makes "if the user sees it, the agent can read it too"
  // structural instead of a coincidence two code paths happen to share. Root is
  // passed explicitly (not rootForEvent) because the sidebar follows the FOCUSED
  // pane and main's implicit window root races the focus sync.
  ipcMain.handle("slack:allowedChannels", async (_e, root: unknown) => {
    if (typeof root !== "string") return { connected: false, channels: [] };
    const [{ channels }, connected, workspace] = await Promise.all([
      slackListAllowedChannelsTool(root),
      slackConnected(root),
      slackWorkspace(root),
    ]);
    return { connected, channels, workspace: workspace ?? undefined };
  });

  ipcMain.handle(
    "slack:downloadFile",
    async (_e, root: unknown, channel: unknown, fileId: unknown) => {
      if (
        typeof root !== "string" ||
        typeof channel !== "string" ||
        typeof fileId !== "string"
      ) {
        return { error: "Invalid payload" };
      }
      return slackDownloadFileTool(root, channel, fileId);
    },
  );

  ipcMain.handle("slack:avatars", async (_e, root: unknown) => {
    if (typeof root !== "string") return {};
    return slackAvatarsTool(root);
  });

  ipcMain.handle(
    "slack:readChannel",
    async (
      _e,
      root: unknown,
      channel: unknown,
      limit: unknown,
      cursor: unknown,
    ) => {
      if (typeof root !== "string" || typeof channel !== "string") {
        return { error: "Invalid payload" };
      }
      const n = typeof limit === "number" ? limit : 20;
      const c = typeof cursor === "string" && cursor ? cursor : undefined;
      return slackReadChannelTool(root, channel, n, {}, c);
    },
  );

  // extensions:getConfig/setConfig -> a connected extension's PER-PROJECT config
  // (non-secret; e.g. Slack's channel allow-list = the permission wall). Stored
  // in .airlock/config.json under extensions.<id>. Secrets (tokens) never go here
  // -- they live in the vault. Root-scoped like config:get/set.
  ipcMain.handle(
    "extensions:getConfig",
    async (e, root: unknown, id: unknown) => {
      if (typeof id !== "string") throw new Error("Invalid payload");
      const cfg = await readProjectConfig(resolveRoot(e, root));
      return cfg.extensions?.[id] ?? {};
    },
  );

  ipcMain.handle(
    "extensions:setConfig",
    async (e, root: unknown, id: unknown, cfg: unknown) => {
      if (typeof id !== "string" || !cfg || typeof cfg !== "object") {
        throw new Error("Invalid payload");
      }
      const r = resolveRoot(e, root);
      const cur = (await readProjectConfig(r)).extensions ?? {};
      const curExt = (cur[id] ?? {}) as Record<string, unknown>;
      const saved = await writeProjectConfig(r, {
        extensions: {
          ...cur,
          [id]: { ...curExt, ...(cfg as Record<string, unknown>) },
        },
      });
      broadcastExtensionsChanged(r);
      return saved.extensions?.[id] ?? {};
    },
  );

  // extensions:connect/disconnect -> a connected provider's in-app auth. connect
  // receives a pasted token (the ONE place a secret value crosses IPC, exactly
  // like secrets:set) and the provider validates it then vaults it main-side;
  // the token never returns to the renderer. disconnect removes the vaulted token.
  ipcMain.handle(
    "extensions:connect",
    (e, root: unknown, id: unknown, secret: unknown) => {
      if (typeof id !== "string" || typeof secret !== "string") {
        throw new Error("Invalid payload");
      }
      const provider = CONNECTED_PROVIDERS[id];
      if (!provider) throw new Error(`Unknown extension: ${id}`);
      return provider.connect(resolveRoot(e, root), secret);
    },
  );

  ipcMain.handle(
    "extensions:disconnect",
    async (e, root: unknown, id: unknown) => {
      if (typeof id !== "string") throw new Error("Invalid payload");
      const provider = CONNECTED_PROVIDERS[id];
      if (!provider) throw new Error(`Unknown extension: ${id}`);
      await provider.disconnect(resolveRoot(e, root));
      return { ok: true };
    },
  );

  // extensions:slackChannels -> every channel the connected token can see, for
  // the allow-list PICKER. Channel names/ids only (no messages, no token). []
  // when Slack is not connected. Slack-specific for v1 (a generic "config option
  // source" hook can generalize it later).
  ipcMain.handle("extensions:slackChannels", (e, root: unknown) =>
    slackAllChannels(resolveRoot(e, root)),
  );

  // slack:listLocalWorkspaces -> the workspaces the Slack desktop app knows
  // about, so the connect modal can name them instead of asking for a T0… id.
  // Machine-wide (not root-scoped): value-free, no token, no project data.
  ipcMain.handle("slack:listLocalWorkspaces", () => localSlackWorkspaces());

  // extensions:oauthBegin -> start the OAuth login for a connected extension,
  // both secret-less "log in -> connected" flows. Returns a discriminated shape
  // telling the renderer what to show; in both cases a fire-and-forget task
  // finishes the login, vaults the token per-project, and pushes
  // extensions:oauthResult to the window.
  //   - "device" (RFC 8628): return a code to type; poll until approved.
  //   - "broker": the app opens the browser to the consent screen and awaits the
  //     airlock:// callback; there's no code to type.
  ipcMain.handle(
    "extensions:oauthBegin",
    async (e, root: unknown, id: unknown) => {
      if (typeof id !== "string") throw new Error("Invalid payload");
      const r = resolveRoot(e, root);
      const spec = CONNECTED_EXTENSIONS.find((x) => x.id === id)?.authSpec;
      // Vault the resulting token + notify the window. Shared by both flows.
      // afterVault is AWAITED and its return is merged into the success event:
      // Slack's workspace verdict has to ride the FIRST result the renderer
      // sees, or the modal closes before the mismatch can be shown. Bounded by
      // the Slack client's own 15s abort; a throw degrades to a plain success,
      // preserving "a good token still connects".
      const finish = (
        p: Promise<string>,
        afterVault?: (token: string) => Promise<Record<string, unknown>>,
      ) =>
        void p
          .then(async (token) => {
            // Slack pools its token per WORKSPACE so other projects can reuse
            // it; every other provider stays per-project. The pooling itself
            // happens in `capture` below, which is the one place that knows
            // the VERIFIED team id -- here we only skip the per-root vault.
            if (id !== "slack") await setSecret(r, oauthTokenName(id), token);
            let extra: Record<string, unknown> = {};
            if (afterVault) {
              try {
                extra = await afterVault(token);
              } catch {
                /* best-effort: the token is good, report the connect */
              }
            }
            e.sender.send("extensions:oauthResult", { id, ok: true, ...extra });
          })
          .catch((err) =>
            e.sender.send("extensions:oauthResult", {
              id,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            }),
          );

      if (spec?.flow === "device") {
        const code = await beginDeviceFlow(spec);
        finish(
          pollDeviceToken(spec, code.deviceCode, code.interval, code.expiresIn),
        );
        return {
          kind: "device" as const,
          userCode: code.userCode,
          verificationUri: code.verificationUri,
          expiresIn: code.expiresIn,
        };
      }
      if (spec?.flow === "broker") {
        const cfg = (await readProjectConfig(r)).extensions?.[id] ?? {};
        const cfgStr = (k: string) =>
          typeof cfg[k] === "string" ? (cfg[k] as string) : "";
        // workspacePin stays a plain string for back-compat (old configs hold a
        // bare team id); workspacePinDomain/-Name ride alongside and are what the
        // named picker writes. No domain -> generic authorize host, as before.
        const parsed = parseWorkspaceInput(cfgStr("workspacePin"));
        const target: WorkspaceTarget = {
          teamId: parsed.teamId,
          domain: cfgStr("workspacePinDomain") || parsed.domain,
        };
        const requested = {
          teamId: target.teamId ?? "",
          domain: target.domain ?? "",
          name: requestedWorkspaceName(target, cfgStr("workspacePinName")),
        };
        // Slack: gate the requested scopes on the per-project opt-in. Opted out
        // (default) requests public-only scopes, so the token literally cannot
        // read private/DM/group; opting in requests the full set. The REQUEST
        // must be conditional -- Slack rejects a connect for scopes the app has
        // not declared. Other broker providers keep their spec scopes as-is.
        const effective =
          id === "slack"
            ? { ...spec, scopes: slackScopes(cfg.includePrivate === true) }
            : spec;
        // Verification, unconditional: `team=` is only a hint, so the ONLY place
        // correctness can be established is here, after the token exists.
        const capture =
          id === "slack"
            ? async (token: string) => {
                const a = await slackAuthTest(token);
                if (!a.ok) return {}; // best-effort: a good token still connected
                const exts = (await readProjectConfig(r)).extensions ?? {};
                const patch = slackWorkspacePatch(exts[id], a);
                await writeProjectConfig(r, {
                  extensions: {
                    ...exts,
                    [id]: { ...(exts[id] ?? {}), ...patch },
                  },
                });
                // Pool it and bind this project -- the same two calls the
                // paste path makes, so the OAuth and paste flows cannot end in
                // different states.
                if (a.teamId) {
                  await addSlackWorkspace(
                    {
                      id: a.teamId,
                      name: a.team ?? a.teamId,
                      domain: a.domain ?? "",
                    },
                    token,
                  );
                  await bindSlackWorkspace(r, a.teamId);
                }
                // The sidebar renders this workspace; without a nudge it kept
                // showing "unknown" until the user hit Refresh.
                broadcastExtensionsChanged(r);
                return {
                  workspace: {
                    id: a.teamId ?? "",
                    name: a.team ?? "",
                    domain: a.domain ?? "",
                  },
                  requested,
                  mismatch: workspaceMismatch(target, {
                    teamId: a.teamId,
                    domain: a.domain,
                  }),
                };
              }
            : undefined;
        finish(runBrokerFlow(effective, target), capture);
        return { kind: "browser" as const };
      }
      throw new Error(`No OAuth login configured for ${id}`);
    },
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

  // Database containers Docker is running, for the Databases provider row.
  // Value-free: image, name and the published host port -- never a credential.
  ipcMain.handle("docker:databases", async () => {
    const { containers } = await dockerStatus().catch(() => ({
      containers: [],
    }));
    return databaseContainers(containers);
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
      // Per-project claude shim: scopes any claude launched in this terminal
      // (auto or hand-typed) to THIS project's MCP endpoint. Blank tabs
      // (root === null) get no shim and stay unscoped (refuse). PATH lives
      // in baseEnv (from getBaseEnv()), NOT in secretEnv (which holds only
      // vaulted secrets and must not contain PATH -- filterDangerousEnv
      // would block it anyway). So prepend binDir to baseEnv PATH here.
      const baseEnvObj = stampAirlockEnv(getBaseEnv());
      if (root) {
        try {
          const { binDir } = await ensureProjectScope(root);
          baseEnvObj.PATH = `${binDir}:${baseEnvObj.PATH ?? process.env.PATH ?? ""}`;
        } catch (err) {
          console.error(
            "[pty:create] ensureProjectScope failed, spawning without shim:",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      const s = createPtySession({
        cwd: root ?? undefined,
        cols,
        rows,
        // Captured login-shell env + the AIRLOCK_IDE marker so a Claude session
        // here knows it is inside AirLock. Injected secrets (already filtered)
        // remain the per-call `env` and still win over baseEnv.
        baseEnv: baseEnvObj,
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
      sessionTargets.set(s.id, e.sender);
      const dataSub = s.onData((data) => {
        const prev = ptyBuffers.get(s.id) ?? "";
        const next = prev + data;
        ptyBuffers.set(
          s.id,
          next.length > TAIL_CAP ? next.slice(-TAIL_CAP) : next,
        );
        // Read the CURRENT target per chunk: pty:adopt may have re-pointed this
        // session to another window since it spawned (tab tear-off / merge).
        const target = sessionTargets.get(s.id);
        if (target && !target.isDestroyed())
          target.send("pty:data", { id: s.id, data });
      });
      const exitSub = s.onExit((exitCode) => {
        sessions.delete(s.id);
        ptyBuffers.delete(s.id);
        sessionWindows.delete(s.id);
        sessionRoots.delete(s.id);
        movingSessions.forget(s.id);
        const target = sessionTargets.get(s.id);
        sessionTargets.delete(s.id);
        if (target && !target.isDestroyed())
          target.send("pty:exit", { id: s.id, exitCode });
        onPtyExitForDevServer(s.id); // managed dev server: terminal closed -> reset
        // Release the listeners explicitly. node-pty has no destroy(); kill()
        // is teardown, but the onData/onExit subscriptions are IDisposables
        // that should be disposed once the session has exited.
        dataSub.dispose();
        exitSub.dispose();
      });
      return s.id;
    },
  );

  // Re-point a LIVE pty's output to the calling window and hand back its recent
  // output so the adopting xterm can rehydrate scrollback. Used by project-tab
  // tear-off / merge: the shell keeps running (a live `claude` never notices), it
  // just streams to a different window from now on.
  //
  // Admitted ONLY for a session main just marked as moving (single-use ticket) --
  // otherwise any window could adopt any pty by guessing an id and break the
  // per-window terminal isolation that sessionWindows enforces.
  ipcMain.handle("pty:adopt", (e, ptyId: unknown): PtyAdoptResult => {
    if (typeof ptyId !== "string" || !sessions.has(ptyId))
      return { ok: false, error: "No such terminal session." };
    if (!movingSessions.claim(ptyId))
      return { ok: false, error: "That terminal is not being moved." };
    // Snapshot the tail and re-point in ONE synchronous block (no await between).
    // node-pty's onData runs on the event loop, so this pair is atomic: no chunk
    // can slip in and be lost from the tail or duplicated into the new window.
    const tail = ptyBuffers.get(ptyId) ?? "";
    sessionTargets.set(ptyId, e.sender);
    const ownerId = BrowserWindow.fromWebContents(e.sender)?.id;
    // The isolation boundary MUST follow the stream, or the moved terminal stays
    // readable by the old window and invisible to the new one.
    if (ownerId !== undefined) sessionWindows.set(ptyId, ownerId);
    return { ok: true, tail };
  });

  // --- Project-tab tear-off / merge ---
  // This window's id, so the renderer can tell whether a hover broadcast is about
  // itself.
  ipcMain.handle(
    "window:id",
    (e) => BrowserWindow.fromWebContents(e.sender)?.id ?? -1,
  );
  ipcMain.handle("tabdrag:start", (e, label: unknown) => {
    const id = BrowserWindow.fromWebContents(e.sender)?.id;
    if (id !== undefined)
      startTabDrag(id, typeof label === "string" ? label : null);
  });
  // A window created for a torn-off tab CLAIMS it once its renderer has mounted.
  // Pull, not push: did-finish-load fires before React's effects run, so a pushed
  // payload could land with nothing subscribed and the tab would be lost.
  ipcMain.handle("tabdrag:takePending", (e): MovingTab | null => {
    const id = BrowserWindow.fromWebContents(e.sender)?.id;
    return id === undefined ? null : takePendingAdopt(id);
  });
  ipcMain.handle("tabdrag:end", (e, payload: unknown): DropTarget => {
    const id = BrowserWindow.fromWebContents(e.sender)?.id;
    if (id === undefined) return { kind: "reorder" };
    return endTabDrag(
      id,
      (payload ?? null) as MovingTab | null,
      movingSessions,
    );
  });

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
  sessionTargets.clear();
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

// The OS pid of a pty's shell (or null if unknown), so the dev-server manager
// can scope port discovery to that terminal's process subtree.
export function ptyPid(ptyId: string): number | null {
  return sessions.get(ptyId)?.pid ?? null;
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

// The focused project's live terminal ptys (pty id + shell pid), so the
// dev-server manager can attribute a listening port to a server running inside
// THIS project's terminals (attributable-only detection). Value-free.
export function terminalPidsForRoot(
  root: string,
): Array<{ ptyId: string; pid: number }> {
  const out: Array<{ ptyId: string; pid: number }> = [];
  for (const [id, s] of sessions) {
    if (sessionRoots.get(id) === root) out.push({ ptyId: id, pid: s.pid });
  }
  return out;
}

// The redacted tail of one terminal's recent output. Scoped to the PASSED root
// (the calling session's project root, resolved from the URL path token -- not
// GUI focus). Audited (ids/counts only, never content). The MCP tool calls THIS
// (not getSecretValue), so the tools.ts source-guard stays green.
export async function getTerminalTail(
  termId: string,
  lines: number,
  root: string | null,
): Promise<{ tail: string } | { error: string }> {
  if (!root) return { error: "No workspace open" };
  // Scope to the calling session's project root only. The window filter is
  // DROPPED: the caller's project may live in a non-focused window when multiple
  // projects are open, so filtering by window would hide valid terminals.
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
// tell them apart (dev-server logs vs idle shell) and pick an id. Scoped to
// the PASSED root (calling session's project, resolved from the path token).
// The window filter is DROPPED (the project may be in a non-focused window).
export async function listTerminals(
  root: string | null,
): Promise<{ id: string; preview: string }[]> {
  if (!root) return [];
  const values = await allVaultedValues(root);
  const out: { id: string; preview: string }[] = [];
  for (const id of sessions.keys()) {
    // Filter by the caller's project root only (not window focus).
    if (sessionRoots.get(id) !== root) continue;
    const raw = ptyBuffers.get(id) ?? "";
    out.push({ id, preview: redactedPreview(raw, values, PREVIEW_LINES) });
  }
  return out;
}
