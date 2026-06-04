import {
  appendAudit,
  commitStaged,
  createBranch,
  createPtySession,
  deleteSecret,
  dockerContainers,
  dockerStart,
  dockerStop,
  filterDangerousEnv,
  getSecretValue,
  ghAccounts,
  gitFileVersions,
  gitStatus,
  importDotEnv,
  injectInto,
  isGitRepo,
  listBranches,
  listDirectory,
  listSecrets,
  listTables,
  type PtySession,
  parseConnString,
  pingDb,
  readAudit,
  readProjectConfig,
  readRows,
  readWorkspaceFile,
  redactConnStrings,
  runGit,
  setSecret,
  stageFiles,
  switchBranch,
  switchGhAccount,
  unstageFiles,
  withDb,
  writeProjectConfig,
} from "@airlock/agent-core";
import { dialog, ipcMain } from "electron";
import type { AppPrefs } from "../shared/ipc";
import { loadPrefs, savePrefs } from "./prefs";

let workspaceRoot: string | null = null;
const sessions = new Map<string, PtySession>();

function requireRoot(): string {
  if (!workspaceRoot) throw new Error("No workspace open");
  return workspaceRoot;
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
  ipcMain.handle("dialog:openFolder", async () => {
    const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (r.canceled || r.filePaths.length === 0) return null;
    workspaceRoot = r.filePaths[0] ?? null;
    return workspaceRoot;
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
    const p = patch as { injectSecretsIntoTerminal?: unknown };
    const clean =
      typeof p.injectSecretsIntoTerminal === "boolean"
        ? { injectSecretsIntoTerminal: p.injectSecretsIntoTerminal }
        : {};
    return writeProjectConfig(requireRoot(), clean);
  });

  // App-global prefs: NOT requireRoot-gated (work with no folder open).
  ipcMain.handle("prefs:get", () => loadPrefs(prefsFile));

  ipcMain.handle("prefs:set", (_e, patch: unknown) => {
    if (!patch || typeof patch !== "object") throw new Error("Invalid payload");
    return savePrefs(prefsFile, patch as Partial<AppPrefs>);
  });

  ipcMain.handle("audit:read", (_e, limit: number) =>
    readAudit(
      requireRoot(),
      Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50,
    ),
  );

  ipcMain.handle("git:isRepo", () => isGitRepo(requireRoot()));

  ipcMain.handle("git:status", () => gitStatus(requireRoot()));

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

  // Docker: machine-global, so NOT requireRoot-gated.
  ipcMain.handle("docker:list", () => dockerContainers());

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
      if (!wc.isDestroyed()) wc.send("pty:data", { id: s.id, data });
    });
    const exitSub = s.onExit((exitCode) => {
      sessions.delete(s.id);
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
}
