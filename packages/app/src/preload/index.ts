import { contextBridge, ipcRenderer } from "electron";
import type {
  AirlockApi,
  PtyDataEvent,
  PtyExitEvent,
  SectionVisibility,
} from "../shared/ipc";

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
  githubInfo: () => ipcRenderer.invoke("github:info"),
  githubSwitch: (host, username) =>
    ipcRenderer.invoke("github:switch", host, username),
  dbList: () => ipcRenderer.invoke("db:list"),
  dbPing: (id) => ipcRenderer.invoke("db:ping", id),
  dbTables: (id) => ipcRenderer.invoke("db:tables", id),
  dbRows: (id, schema, table, limit) =>
    ipcRenderer.invoke("db:rows", id, schema, table, limit),
  neonStatus: () => ipcRenderer.invoke("neon:status"),
  neonConnect: (key) => ipcRenderer.invoke("neon:connect", key),
  neonProjects: () => ipcRenderer.invoke("neon:projects"),
  neonBranches: (p) => ipcRenderer.invoke("neon:branches", p),
  neonDatabases: (p, b) => ipcRenderer.invoke("neon:databases", p, b),
  neonPing: (p, b, db, role) => ipcRenderer.invoke("neon:ping", p, b, db, role),
  neonTables: (p, b, db, role) =>
    ipcRenderer.invoke("neon:tables", p, b, db, role),
  neonRows: (p, b, db, role, schema, table, limit) =>
    ipcRenderer.invoke("neon:rows", p, b, db, role, schema, table, limit),
  dockerList: () => ipcRenderer.invoke("docker:list"),
  dockerStart: (id) => ipcRenderer.invoke("docker:start", id),
  dockerStop: (id) => ipcRenderer.invoke("docker:stop", id),
  prefsGet: () => ipcRenderer.invoke("prefs:get"),
  prefsSet: (patch) => ipcRenderer.invoke("prefs:set", patch),
  setSectionVisibility: (id, visible) =>
    ipcRenderer.invoke("sections:set", id, visible),
  onSectionsChanged: (cb) =>
    subscribe<SectionVisibility>("sections:changed", cb),
};

contextBridge.exposeInMainWorld("airlock", api);
