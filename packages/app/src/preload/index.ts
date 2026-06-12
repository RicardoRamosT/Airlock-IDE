import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AgentCommand,
  AgentCommandResult,
  AirlockApi,
  AnthropicStatus,
  FsChangedEvent,
  LspDiagnostic,
  MenuAction,
  PtyDataEvent,
  PtyExitEvent,
  QuotaStatus,
  SectionVisibility,
  UpdateProgress,
  UpdateStatus,
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
  workspaceOpen: (path) => ipcRenderer.invoke("workspace:open", path),
  workspaceSetActive: (path) => ipcRenderer.invoke("workspace:setActive", path),
  workspaceClose: () => ipcRenderer.invoke("workspace:close"),
  workspaceRoots: (roots) => ipcRenderer.invoke("workspace:roots", roots),
  openFile: () => ipcRenderer.invoke("dialog:openFile"),
  onMenuAction: (cb) => subscribe<MenuAction>("menu:action", cb),
  listDir: (root, relPath) => ipcRenderer.invoke("fs:listDir", root, relPath),
  readFile: (root, relPath) => ipcRenderer.invoke("fs:readFile", root, relPath),
  writeFile: (root, relPath, content) =>
    ipcRenderer.invoke("fs:writeFile", root, relPath, content),
  readImageDataUrl: (root, relPath) =>
    ipcRenderer.invoke("fs:readImage", root, relPath),
  openExternalFile: (root, relPath) =>
    ipcRenderer.invoke("fs:openExternalFile", root, relPath),
  createFile: (root, relPath) => ipcRenderer.invoke("fs:create", root, relPath),
  createDir: (root, relPath) => ipcRenderer.invoke("fs:mkdir", root, relPath),
  moveFile: (root, fromRel, toRel) =>
    ipcRenderer.invoke("fs:move", root, fromRel, toRel),
  duplicateFile: (root, relPath) =>
    ipcRenderer.invoke("fs:duplicate", root, relPath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  importExternal: (root, destRel, srcPaths) =>
    ipcRenderer.invoke("fs:importExternal", root, destRel, srcPaths),
  trashFile: (root, relPath) => ipcRenderer.invoke("fs:trash", root, relPath),
  listAllFiles: (root) => ipcRenderer.invoke("fs:listAll", root),
  searchProject: (root, query) => ipcRenderer.invoke("fs:search", root, query),
  getFileOrder: (root) => ipcRenderer.invoke("fileOrder:get", root),
  setFileOrder: (root, folderRel, names) =>
    ipcRenderer.invoke("fileOrder:set", root, folderRel, names),
  ptyCreate: (cols, rows, root) =>
    ipcRenderer.invoke("pty:create", cols, rows, root),
  ptyInput: (id, data) => ipcRenderer.send("pty:input", { id, data }),
  ptyResize: (id, cols, rows) =>
    ipcRenderer.send("pty:resize", { id, cols, rows }),
  ptyKill: (id) => ipcRenderer.send("pty:kill", id),
  ptyIsBusy: (id) => ipcRenderer.invoke("pty:isBusy", id),
  onPtyData: (cb) => subscribe<PtyDataEvent>("pty:data", cb),
  onPtyExit: (cb) => subscribe<PtyExitEvent>("pty:exit", cb),
  secretsList: (root) => ipcRenderer.invoke("secrets:list", root),
  secretsSet: (root, name, value) =>
    ipcRenderer.invoke("secrets:set", root, name, value),
  secretsDelete: (root, name) =>
    ipcRenderer.invoke("secrets:delete", root, name),
  secretsImportEnv: (root, deleteAfter) =>
    ipcRenderer.invoke("secrets:importEnv", root, deleteAfter),
  secretsReveal: (root, name) =>
    ipcRenderer.invoke("secrets:reveal", root, name),
  clipboardCopySecret: (root, name) =>
    ipcRenderer.invoke("clipboard:copySecret", root, name),
  configGet: (root) => ipcRenderer.invoke("config:get", root),
  configSet: (root, patch) => ipcRenderer.invoke("config:set", root, patch),
  auditRead: (root, limit) => ipcRenderer.invoke("audit:read", root, limit),
  gitIsRepo: (root) => ipcRenderer.invoke("git:isRepo", root),
  gitStatus: (root) => ipcRenderer.invoke("git:status", root),
  gitStage: (root, paths) => ipcRenderer.invoke("git:stage", root, paths),
  gitUnstage: (root, paths) => ipcRenderer.invoke("git:unstage", root, paths),
  gitCommit: (root, message) => ipcRenderer.invoke("git:commit", root, message),
  gitBranches: (root) => ipcRenderer.invoke("git:branches", root),
  gitFetch: (root) => ipcRenderer.invoke("git:fetch", root),
  gitPull: (root) => ipcRenderer.invoke("git:pull", root),
  gitPush: (root) => ipcRenderer.invoke("git:push", root),
  gitSwitchBranch: (root, name) =>
    ipcRenderer.invoke("git:switchBranch", root, name),
  gitCreateBranch: (root, name) =>
    ipcRenderer.invoke("git:createBranch", root, name),
  gitFileVersions: (root, relPath, which) =>
    ipcRenderer.invoke("git:fileVersions", root, relPath, which),
  githubInfo: () => ipcRenderer.invoke("github:info"),
  githubSwitch: (host, username) =>
    ipcRenderer.invoke("github:switch", host, username),
  resolveGithubAccount: (root) =>
    ipcRenderer.invoke("github:resolveAccount", root),
  setProjectGithubAccount: (root, account) =>
    ipcRenderer.invoke("github:setProjectAccount", root, account),
  dbList: (root) => ipcRenderer.invoke("db:list", root),
  dbPing: (root, id) => ipcRenderer.invoke("db:ping", root, id),
  dbTables: (root, id) => ipcRenderer.invoke("db:tables", root, id),
  dbRows: (root, id, schema, table, limit) =>
    ipcRenderer.invoke("db:rows", root, id, schema, table, limit),
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
  renderStatus: () => ipcRenderer.invoke("render:status"),
  renderConnect: (key) => ipcRenderer.invoke("render:connect", key),
  renderServices: () => ipcRenderer.invoke("render:services"),
  activityStatus: (root) => ipcRenderer.invoke("activity:status", root),
  activityDismiss: (id) => ipcRenderer.invoke("activity:dismiss", id),
  integrationsSteady: () => ipcRenderer.invoke("integrations:steady"),
  onActivityChanged: (cb) => subscribe<void>("activity:changed", cb),
  hostLocalUrl: (root) => ipcRenderer.invoke("host:localUrl", root),
  hostProbe: (url) => ipcRenderer.invoke("host:probe", url),
  hostOpenExternal: (url) => ipcRenderer.invoke("host:openExternal", url),
  dockerList: () => ipcRenderer.invoke("docker:list"),
  dockerStart: (id) => ipcRenderer.invoke("docker:start", id),
  dockerStop: (id) => ipcRenderer.invoke("docker:stop", id),
  prefsGet: () => ipcRenderer.invoke("prefs:get"),
  prefsSet: (patch) => ipcRenderer.invoke("prefs:set", patch),
  quotaGet: () => ipcRenderer.invoke("quota:get"),
  usageGet: () => ipcRenderer.invoke("usage:get"),
  onQuotaChanged: (cb) => subscribe<QuotaStatus>("quota:changed", cb),
  anthropicStatusGet: () => ipcRenderer.invoke("anthropicStatus:get"),
  onAnthropicStatusChanged: (cb) =>
    subscribe<AnthropicStatus>("anthropicStatus:changed", cb),
  updateGet: () => ipcRenderer.invoke("update:get"),
  onUpdateChanged: (cb) => subscribe<UpdateStatus>("update:changed", cb),
  updateApply: () => ipcRenderer.invoke("update:apply"),
  onUpdateProgress: (cb) => subscribe<UpdateProgress>("update:progress", cb),
  onSecretsChanged: (cb) => subscribe<string>("secrets:changed", cb),
  setSectionVisibility: (id, visible) =>
    ipcRenderer.invoke("sections:set", id, visible),
  onSectionsChanged: (cb) =>
    subscribe<SectionVisibility>("sections:changed", cb),
  getAgentPolicy: () => ipcRenderer.invoke("agentPolicy:get"),
  setAgentPolicy: (policy) => ipcRenderer.invoke("agentPolicy:set", policy),
  onRequestSecret: (cb) =>
    subscribe<{ requestId: string; name: string; providerHint?: string }>(
      "agent:request-secret",
      cb,
    ),
  requestSecretResolve: (requestId, vaulted) =>
    ipcRenderer.invoke("agent:request-secret-resolved", requestId, vaulted),
  onAgentCommand: (cb) =>
    subscribe<{ id: string; cmd: AgentCommand }>("agent:command", cb),
  agentCommandResult: (id, result: AgentCommandResult) =>
    ipcRenderer.send("agent:command-result", { id, result }),
  onFsChanged: (cb) => subscribe<FsChangedEvent>("fs:changed", cb),
  lspDidOpen: (root, relPath, languageId, version, text) =>
    ipcRenderer.invoke("lsp:didOpen", root, relPath, languageId, version, text),
  lspDidChange: (root, relPath, version, text) =>
    ipcRenderer.invoke("lsp:didChange", root, relPath, version, text),
  lspDidClose: (root, relPath) =>
    ipcRenderer.invoke("lsp:didClose", root, relPath),
  lspHover: (root, relPath, line, character) =>
    ipcRenderer.invoke("lsp:hover", root, relPath, line, character),
  lspCompletion: (root, relPath, line, character) =>
    ipcRenderer.invoke("lsp:completion", root, relPath, line, character),
  lspDefinition: (root, relPath, line, character) =>
    ipcRenderer.invoke("lsp:definition", root, relPath, line, character),
  lspReferences: (root, relPath, line, character) =>
    ipcRenderer.invoke("lsp:references", root, relPath, line, character),
  onLspDiagnostics: (cb) =>
    subscribe<{ root: string; relPath: string; diagnostics: LspDiagnostic[] }>(
      "lsp:diagnostics",
      cb,
    ),
};

contextBridge.exposeInMainWorld("airlock", api);
