import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  appendAudit,
  commitStaged,
  createBranch,
  createDir,
  createFile,
  createPtySession,
  deleteSecret,
  dockerStart,
  dockerStop,
  duplicate,
  filterDangerousEnv,
  getGlobalSecret,
  getSecretValue,
  ghAccounts,
  gitFileVersions,
  importDotEnv,
  injectInto,
  isGitRepo,
  listBranches,
  listDirectory,
  listSecrets,
  listTables,
  move,
  neonConnectionUri,
  type PtySession,
  parseConnString,
  pingDb,
  probePort,
  readAudit,
  readProjectConfig,
  readRows,
  readWorkspaceFile,
  redactConnStrings,
  redactedPreview,
  redactedTail,
  resolveWithin,
  runGit,
  setGlobalSecret,
  setSecret,
  stageFiles,
  switchBranch,
  switchGhAccount,
  unstageFiles,
  withDb,
  writeProjectConfig,
  writeWorkspaceFile,
} from "@airlock/agent-core";
import { BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import type { AppPrefs, Section } from "../shared/ipc";
import { activityStatus, addDismissedActivity } from "./activity";
import { syncWindowWatchers } from "./fsWatch";
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
import { applyAppMenu, applyDockMenu, changeSectionVisibility } from "./menu";
import { loadPrefs, RECENT_CAP, SECTIONS, savePrefs } from "./prefs";
import {
  clearRootForEvent,
  isOpenRoot,
  lastFocusedRoot,
  lastFocusedWindowId,
  rootForEvent,
  setRootForEvent,
  setWindowRoots,
} from "./window";

const sessions = new Map<string, PtySession>();

// Per-PTY owning window (sessionId -> BrowserWindow id). Terminal-reading agent
// tools are scoped to the agent's (last-focused) window, so a window only ever
// sees + reads its OWN terminals. Recorded in pty:create, deleted on exit.
const sessionWindows = new Map<string, number>();

// Per-PTY owning project root (sessionId -> workspace root). One tabbed window
// holds many projects' terminals at once, so window-scoping alone is too coarse:
// the agent must see ONLY the active tab's terminals. switchTab fires
// workspace:setActive, so lastFocusedRoot() == the active tab's root; a terminal
// is the agent's iff sessionRoots.get(id) === lastFocusedRoot(). Recorded in
// pty:create (from rootForEvent at spawn), deleted on exit / killAllSessions.
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
  const first = relPath.split(/[/\\]/)[0];
  if (first === ".airlock") throw new Error("The .airlock folder is protected");
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
    return listDirectory(resolveRoot(e, root), relPath);
  });

  ipcMain.handle("fs:readFile", (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    return readWorkspaceFile(resolveRoot(e, root), relPath);
  });
  ipcMain.handle(
    "fs:writeFile",
    (e, root: unknown, relPath: unknown, content: unknown) => {
      if (typeof relPath !== "string" || typeof content !== "string")
        throw new Error("Invalid payload");
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
  ipcMain.handle("fs:trash", async (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    // resolveWithin returns the absolute, root-confined path for shell.trashItem.
    const abs = await resolveWithin(resolveRoot(e, root), relPath);
    await shell.trashItem(abs);
  });

  ipcMain.handle("secrets:list", (e, root: unknown) =>
    listSecrets(resolveRoot(e, root)),
  );

  ipcMain.handle("secrets:set", (e, root: unknown, name, value) => {
    if (typeof name !== "string" || typeof value !== "string") {
      throw new Error("Invalid payload");
    }
    return setSecret(resolveRoot(e, root), name, value);
  });

  ipcMain.handle("secrets:delete", (e, root: unknown, name) => {
    if (typeof name !== "string") throw new Error("Invalid payload");
    return deleteSecret(resolveRoot(e, root), name);
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
    (e, root: unknown, relPath: unknown, deleteAfter: unknown) => {
      if (typeof relPath !== "string") throw new Error("Invalid payload");
      // Explicit PANE root so .env imports land in the project of the pane the
      // button was clicked in, not the window's active pane.
      return importDotEnv(resolveRoot(e, root), relPath, {
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

  // App-global prefs: NOT requireRoot-gated (work with no folder open).
  ipcMain.handle("prefs:get", () => loadPrefs(prefsFile));

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

  ipcMain.handle("git:commit", (e, root: unknown, message: unknown) => {
    if (typeof message !== "string") throw new Error("Invalid payload");
    return commitStaged(resolveRoot(e, root), message);
  });

  ipcMain.handle("git:branches", (e, root: unknown) =>
    listBranches(resolveRoot(e, root)),
  );

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
  // with no folder; activityStatus skips CI itself when the window has no root).
  ipcMain.handle("activity:status", (e) => activityStatus(rootForEvent(e)));

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

  ipcMain.handle("pty:create", async (e, cols: number, rows: number) => {
    const root = rootForEvent(e);
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
    // Tag the terminal with the project it was spawned under (the sender's root)
    // so the agent's terminal tools can scope to the ACTIVE tab, not just the
    // window. root is the same value pty:create used as the spawn cwd above.
    const sr = rootForEvent(e);
    if (sr) sessionRoots.set(s.id, sr);
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
  });

  // Whether a terminal's shell has a running child (e.g. a live `claude`).
  // Renderer->main UI ONLY (the open-folder helper consults it so a busy
  // terminal is preserved); the agent never calls this -- it is NOT an MCP tool
  // and carries only a session id. Scoped to the sender window's own sessions
  // (consistent with the other pty/terminal handlers). Returns a plain boolean;
  // never throws.
  ipcMain.handle("pty:isBusy", (e, id: unknown) => {
    if (typeof id !== "string") return false;
    const ownerId = BrowserWindow.fromWebContents(e.sender)?.id;
    if (ownerId !== undefined && sessionWindows.get(id) !== ownerId) {
      return false;
    }
    const s = sessions.get(id);
    if (!s) return false;
    return ptyHasChild(s.pid);
  });

  ipcMain.on("pty:input", (_e, payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const { id, data } = payload as { id: string; data: string };
    if (typeof id === "string" && typeof data === "string")
      sessions.get(id)?.write(data);
  });

  ipcMain.on("pty:resize", (_e, payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const { id, cols, rows } = payload as {
      id: string;
      cols: number;
      rows: number;
    };
    if (
      typeof id === "string" &&
      Number.isFinite(cols) &&
      cols > 0 &&
      Number.isFinite(rows) &&
      rows > 0
    )
      sessions.get(id)?.resize(cols, rows);
  });

  ipcMain.on("pty:kill", (_e, id: unknown) => {
    if (typeof id !== "string") return;
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
// the tail/preview can be redacted. Mirrors the db:list value-gather. Main-only.
async function allVaultedValues(root: string): Promise<string[]> {
  const metas = await listSecrets(root);
  const values: string[] = [];
  for (const m of metas) {
    const v = await getSecretValue(root, m.name);
    if (v) values.push(v);
  }
  return values;
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
