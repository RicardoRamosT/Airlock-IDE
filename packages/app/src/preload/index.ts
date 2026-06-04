import { contextBridge, ipcRenderer } from "electron";
import type { AirlockApi, PtyDataEvent, PtyExitEvent } from "../shared/ipc";

function subscribe<T>(channel: string, cb: (e: T) => void): () => void {
  const handler = (_: unknown, e: T) => cb(e);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: AirlockApi = {
  openFolder: () => ipcRenderer.invoke("dialog:openFolder"),
  listDir: (relPath) => ipcRenderer.invoke("fs:listDir", relPath),
  readFile: (relPath) => ipcRenderer.invoke("fs:readFile", relPath),
  ptyCreate: (cols, rows) => ipcRenderer.invoke("pty:create", cols, rows),
  ptyInput: (id, data) => ipcRenderer.send("pty:input", { id, data }),
  ptyResize: (id, cols, rows) =>
    ipcRenderer.send("pty:resize", { id, cols, rows }),
  ptyKill: (id) => ipcRenderer.send("pty:kill", id),
  onPtyData: (cb) => subscribe<PtyDataEvent>("pty:data", cb),
  onPtyExit: (cb) => subscribe<PtyExitEvent>("pty:exit", cb),
  secretsList: () => ipcRenderer.invoke("secrets:list"),
  secretsSet: (name, value) => ipcRenderer.invoke("secrets:set", name, value),
  secretsDelete: (name) => ipcRenderer.invoke("secrets:delete", name),
  secretsImportEnv: (relPath, deleteAfter) =>
    ipcRenderer.invoke("secrets:importEnv", relPath, deleteAfter),
  configGet: () => ipcRenderer.invoke("config:get"),
  configSet: (patch) => ipcRenderer.invoke("config:set", patch),
  auditRead: (limit) => ipcRenderer.invoke("audit:read", limit),
  gitIsRepo: () => ipcRenderer.invoke("git:isRepo"),
  gitStatus: () => ipcRenderer.invoke("git:status"),
  gitStage: (paths) => ipcRenderer.invoke("git:stage", paths),
  gitUnstage: (paths) => ipcRenderer.invoke("git:unstage", paths),
  gitCommit: (message) => ipcRenderer.invoke("git:commit", message),
  gitBranches: () => ipcRenderer.invoke("git:branches"),
  gitSwitchBranch: (name) => ipcRenderer.invoke("git:switchBranch", name),
  gitCreateBranch: (name) => ipcRenderer.invoke("git:createBranch", name),
  gitFileVersions: (relPath, which) =>
    ipcRenderer.invoke("git:fileVersions", relPath, which),
  prefsGet: () => ipcRenderer.invoke("prefs:get"),
  prefsSet: (patch) => ipcRenderer.invoke("prefs:set", patch),
};

contextBridge.exposeInMainWorld("airlock", api);
