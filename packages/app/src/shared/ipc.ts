import type {
  AgentCommandPolicy,
  AuditEntry,
  Container,
  DbTable,
  DiffSide,
  DirEntry,
  FileContent,
  FileVersions,
  GhAccount,
  GhStatus,
  GitStatus,
  ImportResult,
  NeonBranch,
  NeonDatabase,
  NeonProject,
  ProjectConfig,
  QueryResult,
  RiskAction,
  RiskCategory,
  SearchFileResult,
  SearchMatch,
  SearchResults,
  SecretMeta,
} from "@airlock/agent-core";

export type {
  AgentCommandPolicy,
  AuditEntry,
  Container,
  DbTable,
  DiffSide,
  DirEntry,
  FileContent,
  FileVersions,
  GhAccount,
  GhStatus,
  GitStatus,
  ImportResult,
  NeonBranch,
  NeonDatabase,
  NeonProject,
  ProjectConfig,
  QueryResult,
  RiskAction,
  RiskCategory,
  SearchFileResult,
  SearchMatch,
  SearchResults,
  SecretMeta,
};

export interface LspDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity: number; // LSP: 1 error, 2 warning, 3 info, 4 hint
  message: string;
}

export interface LspCompletionItem {
  label: string;
  kind?: number; // LSP CompletionItemKind
  detail?: string;
  documentation?: string;
  insertText?: string;
}

export interface LspHover {
  contents: string;
}

export interface LspDefinition {
  relPath: string;
  line: number; // 1-indexed, ready for revealLine
}

export interface SecretLeak {
  path: string;
  line: number;
  name?: string; // vaulted secret name (kind "vaulted")
  patternType?: string; // provider type (kind "pattern")
}

export interface CommitOutcome {
  committed: boolean;
  sha: string | null;
  blocked?: boolean; // true when a gated commit was held back by a suspected leak
  leaks: SecretLeak[];
}

// run_command's result when the agent command policy gates it (value-free).
export interface CommandGateBlock {
  blocked: true;
  action: "ask" | "block";
  categories: RiskCategory[];
  reason: string;
}

/**
 * A vaulted Postgres connection projected for the renderer. `id` is the secret
 * NAME (e.g. "NEON_DATABASE"), never the value. There is deliberately NO
 * password field: only host/database/user and the redacted string cross the
 * IPC boundary -- the credential stays main-side (see broker.getSecretValue).
 */
export interface DbEntry {
  id: string;
  host: string;
  database: string;
  user: string;
  redacted: string;
}

/**
 * A Render service projected for the renderer's Host section. Enriched
 * main-side with the latest deploy: `deployStatus` is Render's deploy status
 * string, `deployed` is true/false when the deployed commit can be compared to
 * local HEAD, or null when either side is unknown. There is deliberately NO API
 * key and NO raw connection string -- the key stays main-only.
 */
export interface RenderServiceStatus {
  id: string;
  name: string;
  url: string;
  branch: string;
  deployStatus: string;
  deployed: boolean | null;
}

/** One CI step (job) projected for the Activity panel's expandable step list. */
export interface ActivityStep {
  name: string;
  status: string;
  conclusion: string | null;
}

/**
 * A unified in-progress operation for the Activity panel. CI runs, Render
 * deploys, and transitional Docker containers all map onto this single shape.
 * `progress` is determinate (a percentage + label), indeterminate (spinner),
 * or null (no bar). `href` is an optional external link (e.g. the CI run page).
 */
export interface ActivityItem {
  id: string;
  kind: "ci" | "render" | "docker";
  title: string;
  subtitle: string;
  state: "running" | "done" | "failed" | "idle";
  progress:
    | { kind: "determinate"; value: number; label: string }
    | { kind: "indeterminate" }
    | null;
  steps?: ActivityStep[];
  href?: string;
}

/** The repo's local commit identity (git config user.name / user.email). */
export interface GitIdentity {
  name: string | null;
  email: string | null;
}

/** Combined GitHub state: gh-logged-in accounts + the repo's commit identity. */
export interface GithubInfo {
  gh: GhStatus;
  identity: GitIdentity;
}

export type Section =
  | "files"
  | "secrets"
  | "git"
  | "activity"
  | "databases"
  | "docker"
  | "host"
  | "audit";
export type SectionVisibility = Record<Section, boolean>;

/**
 * A File-menu command dispatched main -> renderer over the menu:action channel.
 * The renderer's dispatcher maps each variant to the matching AirlockApi call.
 */
export type MenuAction =
  | { type: "open-folder" }
  | { type: "open-recent"; path: string }
  | { type: "open-file" }
  | { type: "new-tab" }
  | { type: "close-editor" }
  | { type: "close-folder" }
  | { type: "quick-open" }
  | { type: "command-palette" }
  | { type: "find-in-files" };

/**
 * An IDE-control command dispatched main -> renderer over the agent:command
 * channel (the agent-commands round-trip, mirroring request_secret). The
 * terminal Claude (via the IDE-control MCP tools) drives the FOCUSED window's
 * tab/split/terminal layout; the renderer's useAgentCommands hook runs the
 * matching store action and replies with a fresh TabsSnapshot. Every variant
 * carries only tab/terminal ids and a folder path -- NO secret value crosses.
 */
export type AgentCommand =
  | { type: "list_tabs" }
  | { type: "open_tab"; path?: string }
  | { type: "close_tab"; tabId: string }
  | { type: "switch_tab"; tabId: string }
  | { type: "split_view"; tabId?: string; anchorTabId?: string }
  | { type: "open_terminal"; tabId?: string }
  | { type: "close_terminal"; terminalId: string };

/**
 * The layout metadata an IDE-control command returns: one entry per open tab
 * (its id, display name, root, whether it is focused / in the split, and its
 * terminals as {id,title}) plus the split pair. Names/titles only -- there is
 * deliberately NO secret value, env value, or terminal output here, so these
 * tools never widen the no-secret-value surface.
 */
export interface TabsSnapshot {
  tabs: {
    id: string;
    name: string;
    root: string | null;
    focused: boolean;
    inSplit: boolean;
    terminals: { id: string; title: string }[];
  }[];
  split: { a: string; b: string } | null;
}

/**
 * The result of an IDE-control command: the fresh layout metadata on success,
 * or an error string (no live window, timed out, or a store-action throw). The
 * round-trip NEVER rejects -- a failure resolves to { ok: false } so a tool call
 * degrades gracefully.
 */
export type AgentCommandResult =
  | { ok: true; data: TabsSnapshot }
  | { ok: false; error: string };

/** One Claude subscription usage window (5-hour or 7-day). */
export interface QuotaWindow {
  usedPercentage: number; // 0-100
  resetsAt: number; // Unix epoch seconds
}

/**
 * Account-wide Claude subscription usage, parsed from Claude Code's statusLine
 * `rate_limits` payload. `available` is false until the first emit carries
 * rate limits (before the first response, or for non-Pro/Max users). Either
 * window may be null independently. NO token counts cross -- only percentages,
 * a reset timestamp, and a model label.
 */
export interface QuotaStatus {
  fiveHour: QuotaWindow | null;
  sevenDay: QuotaWindow | null;
  model: string | null;
  updatedAt: number; // epoch seconds when the emit was read
  available: boolean;
}

/**
 * App-global preferences (userData JSON) - distinct from per-project config
 * and the keychain. Defined here as the single source of truth so both the
 * main-process store (prefs.ts) and the renderer (via AirlockApi) share it.
 */
export interface AppPrefs {
  sidebarVisible: boolean;
  sidebarPosition: "left" | "right";
  theme: "dark" | "light";
  sectionVisibility: SectionVisibility; // app-global; default all true
  clipboardClearSeconds: number; // app-global; 0 = never auto-clear the clipboard
  openProjectsAsTabs: boolean; // app-global; true = open folders as tabs, false = separate windows
  showRunningProcessNotice: boolean; // app-global; show the kept-busy-terminal notice when opening a folder
  recentFolders: string[]; // app-global; most-recent-first, capped, deduped
  agentPolicy: AgentCommandPolicy; // per-category gate for agent run_command
  // Claude subscription usage meter. ON by default; installs a chained Claude
  // Code statusLine that AirLock reads (set enabled:false to turn it off and
  // remove the statusLine). App-global.
  quotaMeter: { enabled: boolean };
  // Local MCP server identity (HTTP port + bearer token). Optional: absent on
  // first run and generated/persisted by mcp/config.ensureMcpConfig so the
  // registered Claude Code URL stays stable across launches. Never exposed to
  // the renderer beyond this shared type (the token must not reach the UI).
  mcp?: { port: number; token: string };
}

export interface FsChangedEvent {
  root: string;
}

export interface PtyDataEvent {
  id: string;
  data: string;
}

export interface PtyExitEvent {
  id: string;
  exitCode: number;
}

/** Exposed on window.airlock by the preload script. */
export interface AirlockApi {
  openFolder(): Promise<string | null>;
  workspaceOpen(path: string): Promise<string | null>;
  // Point main (and the agent/MCP) at the active tab's project on a tab switch.
  // Lean vs workspaceOpen: it moves the window root + re-points the MCP only,
  // with NO recents/menu changes (switching is not opening).
  workspaceSetActive(path: string): Promise<void>;
  workspaceClose(): Promise<void>;
  // Report the full set of roots open in this window (every tab's root). The
  // store calls this on tab open/close so main can validate a per-project
  // handler's explicit root against the set the user actually opened.
  workspaceRoots(roots: string[]): Promise<void>;
  openFile(): Promise<string | null>;
  onMenuAction(cb: (a: MenuAction) => void): () => void;
  // Per-project methods below take a leading `root` (the calling pane's): two
  // panes share one window, so the window root alone is ambiguous. Main accepts
  // it only if it is a root the user opened in this window, else falls back to
  // the window root -- single-pane callers pass their window root, so behavior
  // is identical.
  listDir(root: string, relPath: string): Promise<DirEntry[]>;
  readFile(root: string, relPath: string): Promise<FileContent>;
  // Save edited text back to a workspace file (GUI editor autosave). Pane-scoped
  // by root; a USER action, never an MCP tool (the agent stays value-blind).
  writeFile(root: string, relPath: string, content: string): Promise<void>;
  // Read a (raster) image as a data URL for inline preview. Over ~25 MB --
  // { dataUrl: "", tooLarge: true } (the UI offers Open Externally).
  readImageDataUrl(
    root: string,
    relPath: string,
  ): Promise<{ dataUrl: string; tooLarge: boolean }>;
  // Open a workspace file in the OS default app (binary files / oversized
  // images). Path-confined; the .airlock vault is rejected.
  openExternalFile(root: string, relPath: string): Promise<void>;
  // File management (USER actions; path-confined to the pane root). create/mkdir
  // fail if the target exists; move covers rename + the future drag-drop;
  // duplicate returns the new relPath; trash sends to the OS Trash (recoverable).
  // The .airlock vault dir is rejected by the handlers (defense in depth).
  createFile(root: string, relPath: string): Promise<void>;
  createDir(root: string, relPath: string): Promise<void>;
  moveFile(root: string, fromRel: string, toRel: string): Promise<void>;
  duplicateFile(root: string, relPath: string): Promise<string>;
  trashFile(root: string, relPath: string): Promise<void>;
  // Flat list of every file relpath in the project (palette quick-open). Honors
  // the same IGNORED set as the tree; capped, with `truncated` set when hit.
  listAllFiles(root: string): Promise<{ files: string[]; truncated: boolean }>;
  // Search file contents across the project (find-in-files). Case-insensitive
  // substring; results grouped by file; capped (truncated flag).
  searchProject(root: string, query: string): Promise<SearchResults>;
  // Manual file ordering (USER action; per-folder custom order persisted to a
  // committed .airlock-order.json at the project root, path-confined). getFileOrder
  // returns the whole map for a root (folderRel -> ordered names); setFileOrder
  // writes one folder's order (empty names clears it). Pure view metadata -- NO
  // file contents cross, only names the tree already shows.
  getFileOrder(root: string): Promise<Record<string, string[]>>;
  setFileOrder(root: string, folderRel: string, names: string[]): Promise<void>;
  ptyCreate(cols: number, rows: number): Promise<string>;
  ptyInput(id: string, data: string): void;
  ptyResize(id: string, cols: number, rows: number): void;
  ptyKill(id: string): void;
  // Whether a terminal's shell has a running child process (e.g. a live
  // `claude`). Renderer UI only (consulted by the open-folder flow so a busy
  // terminal is kept, not killed); not an agent/MCP surface. Returns false for
  // an unknown id or any error -- never throws.
  ptyIsBusy(id: string): Promise<boolean>;
  onPtyData(cb: (e: PtyDataEvent) => void): () => void;
  onPtyExit(cb: (e: PtyExitEvent) => void): () => void;
  secretsList(root: string): Promise<SecretMeta[]>;
  secretsSet(root: string, name: string, value: string): Promise<SecretMeta>;
  secretsDelete(root: string, name: string): Promise<void>;
  secretsImportEnv(
    root: string,
    relPath: string,
    deleteAfter: boolean,
  ): Promise<ImportResult>;
  secretsReveal(root: string, name: string): Promise<string | null>;
  clipboardCopySecret(
    root: string,
    name: string,
  ): Promise<{ copied: boolean; clearAfterSeconds: number }>;
  configGet(root: string): Promise<ProjectConfig>;
  configSet(
    root: string,
    patch: Partial<ProjectConfig>,
  ): Promise<ProjectConfig>;
  auditRead(root: string, limit: number): Promise<AuditEntry[]>;
  gitIsRepo(root: string): Promise<boolean>;
  gitStatus(root: string): Promise<GitStatus>;
  gitStage(root: string, paths: string[]): Promise<void>;
  gitUnstage(root: string, paths: string[]): Promise<void>;
  gitCommit(root: string, message: string): Promise<CommitOutcome>;
  gitBranches(root: string): Promise<string[]>;
  gitFetch(root: string): Promise<void>;
  gitPull(root: string): Promise<void>;
  gitPush(root: string): Promise<void>;
  gitSwitchBranch(root: string, name: string): Promise<void>;
  gitCreateBranch(root: string, name: string): Promise<void>;
  gitFileVersions(
    root: string,
    relPath: string,
    which: DiffSide,
  ): Promise<FileVersions>;
  githubInfo(): Promise<GithubInfo>;
  githubSwitch(host: string, username: string): Promise<void>;
  // Databases: id is the secret NAME; no password ever crosses these. dbList
  // returns redacted projections; ping/tables/rows return data or a
  // message-only error -- never the connection string.
  dbList(root: string): Promise<DbEntry[]>;
  dbPing(root: string, id: string): Promise<{ ok: boolean; error?: string }>;
  dbTables(root: string, id: string): Promise<DbTable[]>;
  dbRows(
    root: string,
    id: string,
    schema: string,
    table: string,
    limit: number,
  ): Promise<QueryResult>;
  // Neon: REST-backed control plane (status/connect) + branch-scoped data
  // access. The API key crosses only on neonConnect; thereafter projects are
  // addressed by id. ping/tables/rows mirror the db* shape but are keyed by
  // (projectId, branchId, database, role) instead of a vaulted secret name.
  neonStatus(): Promise<{ connected: boolean }>;
  neonConnect(key: string): Promise<{ connected: boolean }>;
  neonProjects(): Promise<NeonProject[]>;
  neonBranches(projectId: string): Promise<NeonBranch[]>;
  neonDatabases(projectId: string, branchId: string): Promise<NeonDatabase[]>;
  neonPing(
    projectId: string,
    branchId: string,
    database: string,
    role: string,
  ): Promise<{ ok: boolean; error?: string }>;
  neonTables(
    projectId: string,
    branchId: string,
    database: string,
    role: string,
  ): Promise<DbTable[]>;
  neonRows(
    projectId: string,
    branchId: string,
    database: string,
    role: string,
    schema: string,
    table: string,
    limit: number,
  ): Promise<QueryResult>;
  // Render: app-global (account-level, NOT root-gated). The API key crosses
  // only on renderConnect and is NEVER returned. renderServices returns an
  // enriched per-service status (deploy state + deployed-vs-HEAD) with no key.
  renderStatus(): Promise<{ connected: boolean }>;
  renderConnect(key: string): Promise<{ connected: boolean }>;
  renderServices(): Promise<RenderServiceStatus[]>;
  // Activity: aggregated in-progress operations (CI + Render + Docker) for the
  // Activity panel. NOT root-gated; CI is skipped when no folder is open.
  // activityDismiss hides an entry by id (app-global, in-memory) and broadcasts
  // activity:changed to all windows; a new run/deploy (new id) reappears.
  activityStatus(): Promise<ActivityItem[]>;
  activityDismiss(id: string): Promise<void>;
  onActivityChanged(cb: () => void): () => void;
  // Host/local dev server: hostProbe + hostOpenExternal are global; hostLocalUrl
  // is per-project (config.devUrl, else guessed). hostOpenExternal opens only
  // http(s) URLs in the system browser.
  hostLocalUrl(root: string): Promise<string | null>;
  hostProbe(url: string): Promise<{ up: boolean }>;
  hostOpenExternal(url: string): Promise<void>;
  // Docker: machine-global (NOT root-gated); ids are opaque container ids.
  dockerList(): Promise<{
    installed: boolean;
    running: boolean;
    containers: Container[];
  }>;
  dockerStart(id: string): Promise<void>;
  dockerStop(id: string): Promise<void>;
  prefsGet(): Promise<AppPrefs>;
  prefsSet(patch: Partial<AppPrefs>): Promise<AppPrefs>;
  // Claude quota meter: last-known account usage (null before the first emit),
  // pushed live on quota:changed.
  quotaGet(): Promise<QuotaStatus | null>;
  onQuotaChanged(cb: (s: QuotaStatus) => void): () => void;
  setSectionVisibility(
    id: Section,
    visible: boolean,
  ): Promise<SectionVisibility>;
  onSectionsChanged(cb: (v: SectionVisibility) => void): () => void;
  getAgentPolicy(): Promise<AgentCommandPolicy>;
  setAgentPolicy(policy: AgentCommandPolicy): Promise<AgentCommandPolicy>;
  // Agent-requested secret: main pushes agent:request-secret when the
  // request_secret MCP tool asks the user to vault a secret. The renderer opens
  // the secure modal, then reports the outcome via requestSecretResolve. ONLY a
  // boolean crosses back -- the value goes user -> keychain via secretsSet; the
  // agent never sees it.
  onRequestSecret(
    cb: (p: { requestId: string; name: string; providerHint?: string }) => void,
  ): () => void;
  requestSecretResolve(requestId: string, vaulted: boolean): Promise<void>;
  // Agent IDE-control command: main pushes agent:command when an IDE-control MCP
  // tool (list_tabs/open_tab/close_tab/switch_tab/split_view/open_terminal/
  // close_terminal) drives the focused window. The useAgentCommands hook runs the
  // matching store action and reports the resulting layout via agentCommandResult.
  // Only tab/terminal ids + a path cross in, and layout metadata (names/titles)
  // crosses back -- NO secret value, consistent with the no-secrets invariant.
  onAgentCommand(
    cb: (p: { id: string; cmd: AgentCommand }) => void,
  ): () => void;
  agentCommandResult(id: string, result: AgentCommandResult): void;
  // The main-process chokidar watcher pushes this (debounced) whenever anything
  // changes under an open root -- user ops, the agent's terminal, git. The
  // FileTree re-lists. NO file contents cross; just the root that changed.
  onFsChanged(cb: (e: FsChangedEvent) => void): () => void;
  // Language server (slice 1: diagnostics). The renderer syncs the open doc;
  // diagnostics are pushed back. NO secret value crosses -- only file paths +
  // the text the user is editing.
  lspDidOpen(
    root: string,
    relPath: string,
    languageId: string,
    version: number,
    text: string,
  ): Promise<void>;
  lspDidChange(
    root: string,
    relPath: string,
    version: number,
    text: string,
  ): Promise<void>;
  lspDidClose(root: string, relPath: string): Promise<void>;
  onLspDiagnostics(
    cb: (e: {
      root: string;
      relPath: string;
      diagnostics: LspDiagnostic[];
    }) => void,
  ): () => void;
  lspHover(
    root: string,
    relPath: string,
    line: number,
    character: number,
  ): Promise<LspHover | null>;
  lspCompletion(
    root: string,
    relPath: string,
    line: number,
    character: number,
  ): Promise<LspCompletionItem[]>;
  lspDefinition(
    root: string,
    relPath: string,
    line: number,
    character: number,
  ): Promise<LspDefinition | null>;
}
