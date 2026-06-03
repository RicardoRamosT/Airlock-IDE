import {
  createPtySession,
  listDirectory,
  type PtySession,
  readWorkspaceFile,
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

  ipcMain.handle("pty:create", (e, cols: number, rows: number) => {
    const s = createPtySession({ cwd: workspaceRoot ?? undefined, cols, rows });
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

  ipcMain.on("pty:input", (_e, { id, data }: { id: string; data: string }) => {
    sessions.get(id)?.write(data);
  });

  ipcMain.on(
    "pty:resize",
    (_e, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
      sessions.get(id)?.resize(cols, rows);
    },
  );
}

export function killAllSessions(): void {
  for (const s of sessions.values()) s.kill();
  sessions.clear();
}
