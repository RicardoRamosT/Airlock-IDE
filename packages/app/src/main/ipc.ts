import path from "node:path";
import {
  appendAudit,
  commitStaged,
  createBranch,
  createPtySession,
  deleteSecret,
  dockerStart,
  dockerStop,
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
  runGit,
  setGlobalSecret,
  setSecret,
  stageFiles,
  switchBranch,
  switchGhAccount,
  unstageFiles,
  withDb,
  writeProjectConfig,
} from "@airlock/agent-core";
import { clipboard, dialog, ipcMain, shell } from "electron";
import type { AppPrefs, Section } from "../shared/ipc";
import { activityStatus } from "./activity";
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
import { applyAppMenu, changeSectionVisibility } from "./menu";
import { loadPrefs, RECENT_CAP, SECTIONS, savePrefs } from "./prefs";

let workspaceRoot: string | null = null;
const sessions = new Map<string, PtySession>();

// Per-PTY ring buffer of recent raw output (tee'd from onData). Bounded so it
// cannot grow unbounded; read (redacted) by get_terminal_tail. Deleted on exit.
const ptyBuffers = new Map<string, string>();
const TAIL_CAP = 256 * 1024; // bytes of raw output retained per terminal
const DEFAULT_TAIL_LINES = 40;
const MAX_TAIL_LINES = 400;
const PREVIEW_LINES = 3;

function requireRoot(): string {
  if (!workspaceRoot) throw new Error("No workspace open");
  return workspaceRoot;
}

// Accessor for the module-private workspaceRoot. The MCP server reads the
// current workspace root through this rather than holding its own copy, so
// there is one source of truth for the open folder.
export function getWorkspaceRoot(): string | null {
  return workspaceRoot;
}

export function setWorkspaceRoot(root: string | null): void {
  workspaceRoot = root;
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
//
// onFolderOpen is an OPTIONAL callback invoked when the user opens a folder
// (dialog:openFolder resolves to a non-null path). The MCP server uses it to
// re-register with Claude Code keyed to the newly opened project dir. Omitting
// it keeps the existing registerIpc(getBaseEnv, prefsFile) call valid.
export function registerIpc(
  getBaseEnv: () => Record<string, string> = () => ({}),
  prefsFile = "",
  onFolderOpen?: (root: string) => void,
): void {
  // App-global audit chain (userData-level), for global credential writes.
  const globalAuditLog = prefsFile
    ? path.join(path.dirname(prefsFile), "audit-global.jsonl")
    : "";

  // Open a workspace at a known path: set root, re-register MCP (onFolderOpen),
  // record the folder in recents (most-recent-first, deduped, capped), and
  // rebuild the menu so Open Recent reflects it.
  async function recordAndOpen(root: string): Promise<void> {
    workspaceRoot = root;
    onFolderOpen?.(root);
    const prev = await loadPrefs(prefsFile);
    const recents = [
      root,
      ...prev.recentFolders.filter((p) => p !== root),
    ].slice(0, RECENT_CAP);
    await savePrefs(prefsFile, { recentFolders: recents });
    applyAppMenu(prefsFile, prev.sectionVisibility, recents);
  }

  ipcMain.handle("dialog:openFolder", async () => {
    const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (r.canceled || r.filePaths.length === 0) return null;
    const picked = r.filePaths[0];
    if (!picked) return null;
    await recordAndOpen(picked);
    return picked;
  });

  ipcMain.handle("workspace:open", async (_e, p: unknown) => {
    if (typeof p !== "string") throw new Error("Invalid payload");
    await recordAndOpen(p);
    return p;
  });

  ipcMain.handle("workspace:close", () => {
    workspaceRoot = null;
  });

  // Pick a file to view; return it RELATIVE to the open folder (the viewer read
  // path is workspace-confined). null if cancelled, no folder open, or outside.
  ipcMain.handle("dialog:openFile", async () => {
    if (!workspaceRoot) return null;
    const r = await dialog.showOpenDialog({
      properties: ["openFile"],
      defaultPath: workspaceRoot,
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    const picked = r.filePaths[0];
    if (!picked) return null;
    const rel = path.relative(workspaceRoot, picked);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    return rel;
  });

  ipcMain.handle("fs:listDir", (_e, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    return listDirectory(requireRoot(), relPath);
  });

  ipcMain.handle("fs:readFile", (_e, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    return readWorkspaceFile(requireRoot(), relPath);
  });

  ipcMain.handle("secrets:list", () => listSecrets(requireRoot()));

  ipcMain.handle("secrets:set", (_e, name: string, value: string) => {
    if (typeof name !== "string" || typeof value !== "string") {
      throw new Error("Invalid payload");
    }
    return setSecret(requireRoot(), name, value);
  });

  ipcMain.handle("secrets:delete", (_e, name: string) => {
    if (typeof name !== "string") throw new Error("Invalid payload");
    return deleteSecret(requireRoot(), name);
  });

  // OWNER-ONLY value path. The renderer is the human's surface; the agent (a
  // separate process, reachable only over MCP) cannot call this IPC and is NOT
  // given any value tool. Audited (name only). See broker.getSecretValue banner.
  ipcMain.handle("secrets:reveal", async (_e, name: unknown) => {
    if (typeof name !== "string") throw new Error("Invalid payload");
    const root = requireRoot();
    await appendAudit(root, "user", "secret.reveal", { name });
    return getSecretValue(root, name);
  });

  // Copy by NAME so the value never enters the renderer: main resolves it, puts
  // it on the clipboard, and conditionally auto-clears after the configured delay
  // (0 = never; clears only if the clipboard still holds this exact value).
  ipcMain.handle("clipboard:copySecret", async (_e, name: unknown) => {
    if (typeof name !== "string") throw new Error("Invalid payload");
    const root = requireRoot();
    const value = await getSecretValue(root, name);
    if (value === null) return { copied: false, clearAfterSeconds: 0 };
    clipboard.writeText(value);
    await appendAudit(root, "user", "secret.copy", { name });
    const seconds = (await loadPrefs(prefsFile)).clipboardClearSeconds;
    if (seconds > 0) {
      setTimeout(() => {
        if (clipboard.readText() === value) clipboard.writeText("");
      }, seconds * 1000);
    }
    return { copied: true, clearAfterSeconds: seconds };
  });

  ipcMain.handle(
    "secrets:importEnv",
    (_e, relPath: string, deleteAfter: boolean) => {
      if (typeof relPath !== "string") throw new Error("Invalid payload");
      return importDotEnv(requireRoot(), relPath, {
        deleteAfter: deleteAfter === true,
      });
    },
  );

  ipcMain.handle("config:get", () => readProjectConfig(requireRoot()));

  ipcMain.handle("config:set", (_e, patch: unknown) => {
    if (!patch || typeof patch !== "object") throw new Error("Invalid payload");
    const p = patch as {
      injectSecretsIntoTerminal?: unknown;
      devUrl?: unknown;
    };
    const clean: { injectSecretsIntoTerminal?: boolean; devUrl?: string } = {};
    if (typeof p.injectSecretsIntoTerminal === "boolean")
      clean.injectSecretsIntoTerminal = p.injectSecretsIntoTerminal;
    if (typeof p.devUrl === "string") clean.devUrl = p.devUrl;
    return writeProjectConfig(requireRoot(), clean);
  });

  // App-global prefs: NOT requireRoot-gated (work with no folder open).
  ipcMain.handle("prefs:get", () => loadPrefs(prefsFile));

  ipcMain.handle("prefs:set", (_e, patch: unknown) => {
    if (!patch || typeof patch !== "object") throw new Error("Invalid payload");
    return savePrefs(prefsFile, patch as Partial<AppPrefs>);
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

  ipcMain.handle("audit:read", (_e, limit: number) =>
    readAudit(
      requireRoot(),
      Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50,
    ),
  );

  ipcMain.handle("git:isRepo", () => isGitRepo(requireRoot()));

  ipcMain.handle("git:status", () => gitStatusFor(requireRoot()));

  ipcMain.handle("git:stage", (_e, paths: unknown) => {
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== "string")) {
      throw new Error("Invalid payload");
    }
    return stageFiles(requireRoot(), paths as string[]);
  });

  ipcMain.handle("git:unstage", (_e, paths: unknown) => {
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== "string")) {
      throw new Error("Invalid payload");
    }
    return unstageFiles(requireRoot(), paths as string[]);
  });

  ipcMain.handle("git:commit", (_e, message: unknown) => {
    if (typeof message !== "string") throw new Error("Invalid payload");
    return commitStaged(requireRoot(), message);
  });

  ipcMain.handle("git:branches", () => listBranches(requireRoot()));

  ipcMain.handle("git:switchBranch", (_e, name: unknown) => {
    if (typeof name !== "string") throw new Error("Invalid payload");
    return switchBranch(requireRoot(), name);
  });

  ipcMain.handle("git:createBranch", (_e, name: unknown) => {
    if (typeof name !== "string") throw new Error("Invalid payload");
    return createBranch(requireRoot(), name);
  });

  ipcMain.handle("git:fileVersions", (_e, relPath: unknown, which: unknown) => {
    if (
      typeof relPath !== "string" ||
      (which !== "staged" && which !== "unstaged")
    ) {
      throw new Error("Invalid payload");
    }
    return gitFileVersions(requireRoot(), relPath, which);
  });

  // GitHub accounts + commit identity: NOT requireRoot-gated. gh accounts are
  // app-global and must list with no folder open; the repo identity is just
  // null then. gh redacts tokens, so airlock never sees credentials.
  ipcMain.handle("github:info", async () => {
    const gh = await ghAccounts();
    let name: string | null = null;
    let email: string | null = null;
    if (workspaceRoot) {
      try {
        name =
          (await runGit(workspaceRoot, ["config", "user.name"])).trim() || null;
      } catch {}
      try {
        email =
          (await runGit(workspaceRoot, ["config", "user.email"])).trim() ||
          null;
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
  async function dbConnString(id: string): Promise<string> {
    const root = requireRoot();
    const value = await getSecretValue(root, id);
    if (!value) throw new Error("Database secret not found");
    return value;
  }

  ipcMain.handle("db:list", async () => {
    const root = requireRoot();
    const metas = (await listSecrets(root)).filter(
      (m) => m.provider === "postgres-url",
    );
    const out = [];
    for (const m of metas) {
      const value = await getSecretValue(root, m.name);
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

  ipcMain.handle("db:ping", async (_e, id: unknown) => {
    if (typeof id !== "string") throw new Error("Invalid payload");
    try {
      await withDb(await dbConnString(id), (run) => pingDb(run));
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

  ipcMain.handle("db:tables", async (_e, id: unknown) => {
    if (typeof id !== "string") throw new Error("Invalid payload");
    try {
      return await withDb(await dbConnString(id), (run) => listTables(run));
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
      _e,
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
        return await withDb(await dbConnString(id), (run) =>
          readRows(run, schema, table, lim),
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
  ipcMain.handle("render:services", () => renderServicesStatus(workspaceRoot));

  // Host/local dev server: host:probe + host:openExternal are global (NOT
  // requireRoot-gated). host:localUrl resolves the per-project dev URL so it IS
  // requireRoot-gated (config.devUrl, else guessed from package.json).
  // Per-project dev URL (config.devUrl, else guessed from package.json). Shape
  // is unchanged (string | null); the resolution logic lives in ide-state's
  // resolveDevUrl so hostStatus (MCP) shares the exact same URL guess.
  ipcMain.handle("host:localUrl", () => resolveDevUrl(requireRoot()));
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
  // with no folder; activityStatus skips CI itself when workspaceRoot is null).
  ipcMain.handle("activity:status", () => activityStatus(workspaceRoot));

  ipcMain.handle("docker:start", (_e, id: unknown) => {
    if (typeof id !== "string") throw new Error("Invalid payload");
    return dockerStart(id);
  });

  ipcMain.handle("docker:stop", (_e, id: unknown) => {
    if (typeof id !== "string") throw new Error("Invalid payload");
    return dockerStop(id);
  });

  ipcMain.handle("pty:create", async (e, cols: number, rows: number) => {
    let secretEnv: Record<string, string> | undefined;
    if (workspaceRoot) {
      const cfg = await readProjectConfig(workspaceRoot);
      if (cfg.injectSecretsIntoTerminal) {
        try {
          const r = await injectInto(workspaceRoot, {});
          const { safe, blocked } = filterDangerousEnv(r.env);
          secretEnv = safe;
          if (blocked.length > 0) {
            await appendAudit(workspaceRoot, "user", "secret.inject.blocked", {
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
      cwd: workspaceRoot ?? undefined,
      cols,
      rows,
      // Captured login-shell env (legitimate PATH/locale) is the base; it is
      // NOT run through filterDangerousEnv. Injected secrets (already filtered
      // above) are the per-call env and still win over baseEnv.
      baseEnv: getBaseEnv(),
      env: secretEnv,
    });
    sessions.set(s.id, s);
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
      if (!wc.isDestroyed()) wc.send("pty:exit", { id: s.id, exitCode });
      // Release the listeners explicitly. node-pty has no destroy(); kill()
      // is teardown, but the onData/onExit subscriptions are IDisposables
      // that should be disposed once the session has exited.
      dataSub.dispose();
      exitSub.dispose();
    });
    return s.id;
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
  if (!workspaceRoot) return { error: "No workspace open" };
  const raw = ptyBuffers.get(termId);
  if (raw === undefined) return { error: "No such terminal" };
  const n = Math.min(
    MAX_TAIL_LINES,
    Math.max(1, Math.floor(lines) || DEFAULT_TAIL_LINES),
  );
  const values = await allVaultedValues(workspaceRoot);
  const tail = redactedTail(raw, values, n);
  await appendAudit(workspaceRoot, "agent", "terminal.read", {
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
  const values = workspaceRoot ? await allVaultedValues(workspaceRoot) : [];
  const out: { id: string; preview: string }[] = [];
  for (const id of sessions.keys()) {
    const raw = ptyBuffers.get(id) ?? "";
    out.push({ id, preview: redactedPreview(raw, values, PREVIEW_LINES) });
  }
  return out;
}
