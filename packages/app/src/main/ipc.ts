import {
  appendAudit,
  createPtySession,
  deleteSecret,
  filterDangerousEnv,
  importDotEnv,
  injectInto,
  listDirectory,
  listSecrets,
  type PtySession,
  readAudit,
  readProjectConfig,
  readWorkspaceFile,
  setSecret,
  writeProjectConfig,
} from "@airlock/agent-core";
import { dialog, ipcMain } from "electron";

let workspaceRoot: string | null = null;
const sessions = new Map<string, PtySession>();

function requireRoot(): string {
  if (!workspaceRoot) throw new Error("No workspace open");
  return workspaceRoot;
}

export function registerIpc(): void {
  ipcMain.handle("dialog:openFolder", async () => {
    const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (r.canceled || r.filePaths.length === 0) return null;
    workspaceRoot = r.filePaths[0] ?? null;
    return workspaceRoot;
  });

  ipcMain.handle("fs:listDir", (_e, relPath: string) =>
    listDirectory(requireRoot(), relPath),
  );

  ipcMain.handle("fs:readFile", (_e, relPath: string) =>
    readWorkspaceFile(requireRoot(), relPath),
  );

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

  ipcMain.handle("audit:read", (_e, limit: number) =>
    readAudit(
      requireRoot(),
      Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50,
    ),
  );

  ipcMain.handle("pty:create", async (e, cols: number, rows: number) => {
    let secretEnv: Record<string, string> | undefined;
    if (workspaceRoot) {
      const cfg = await readProjectConfig(workspaceRoot);
      if (cfg.injectSecretsIntoTerminal) {
        const r = await injectInto(workspaceRoot, {});
        const { safe, blocked } = filterDangerousEnv(r.env);
        secretEnv = safe;
        if (blocked.length > 0) {
          await appendAudit(workspaceRoot, "user", "secret.inject.blocked", {
            names: blocked,
            reason: "dangerous env name at spawn site",
          });
        }
      }
    }
    const s = createPtySession({
      cwd: workspaceRoot ?? undefined,
      cols,
      rows,
      env: secretEnv,
    });
    sessions.set(s.id, s);
    const wc = e.sender;
    s.onData((data) => {
      if (!wc.isDestroyed()) wc.send("pty:data", { id: s.id, data });
    });
    s.onExit((exitCode) => {
      sessions.delete(s.id);
      if (!wc.isDestroyed()) wc.send("pty:exit", { id: s.id, exitCode });
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
}

export function killAllSessions(): void {
  for (const s of sessions.values()) s.kill();
  sessions.clear();
}
