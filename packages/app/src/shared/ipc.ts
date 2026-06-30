import type {
  AgentCommandPolicy,
  AnthropicIndicator,
  AuditEntry,
  Container,
  DbTable,
  DevServerState,
  DiffSide,
  DirEntry,
  EnvDiffEntry,
  EnvFileImport,
  EventFilter,
  FileContent,
  FileVersions,
  GhAccount,
  GhStatus,
  GitStatus,
  ImportExternalResult,
  ImportResult,
  Level,
  LogEvent,
  NeonAccountRef,
  NeonBranch,
  NeonDatabase,
  NeonOrg,
  NeonProject,
  ProjectArea,
  ProjectConfig,
  ProjectProfile,
  ProjectTech,
  QueryResult,
  RenderDeploy,
  RiskAction,
  RiskCategory,
  SearchFileResult,
  SearchMatch,
  SearchResults,
  SecretMeta,
  SteadyIntegration,
  TechCategory,
} from "@airlock/agent-core";

// DevServerState re-exported via import type only (erased at build — never a
// value import; only npm run package catches a violation).
export type { DevServerState } from "@airlock/agent-core";
export type DevServerStartResult =
  | { ok: true; state: DevServerState }
  | { ok: false; needsCommand: true; guess: string | null };

// A detected unmanaged (user-run) dev server: a LISTEN port owned by a process
// in one of THIS project's terminals. Plain interface — no agent-core import.
export interface DetectedDevServer {
  port: number;
  ptyId: string;
}

export type {
  IntegrationItem,
  ItemAction,
  ItemDetail,
  SteadyIntegration,
} from "@airlock/agent-core";
export type {
  AgentCommandPolicy,
  AnthropicIndicator,
  AuditEntry,
  Container,
  DbTable,
  DiffSide,
  DirEntry,
  EnvDiffEntry,
  EnvFileImport,
  EventFilter,
  FileContent,
  FileVersions,
  GhAccount,
  GhStatus,
  GitStatus,
  ImportExternalResult,
  ImportResult,
  LogEvent,
  NeonAccountRef,
  NeonBranch,
  NeonDatabase,
  NeonOrg,
  NeonProject,
  ProjectArea,
  ProjectConfig,
  ProjectProfile,
  ProjectTech,
  QueryResult,
  RenderDeploy,
  RiskAction,
  RiskCategory,
  SearchFileResult,
  SearchMatch,
  SearchResults,
  SecretMeta,
  TechCategory,
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

export interface ReferenceHit {
  line: number; // 1-indexed, ready for openEditorFile / revealLine
  character: number; // 0-indexed column
  snippet: string; // trimmed source line (may be empty)
}
export interface ReferenceFile {
  relPath: string;
  hits: ReferenceHit[];
}
export type ReferenceResults = ReferenceFile[];

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

// Outcome of the send_terminal_input MCP tool. Value-free: it reports whether
// the bytes were sent or why not -- never terminal output or a secret.
export interface TerminalInputResult {
  sent?: true;
  denied?: true;
  timedOut?: true;
  busy?: true;
  error?: string;
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
  // Expandable details (all best-effort; "" / null when Render omits them).
  type: string; // "web_service" | "static_site" | ...
  region: string;
  plan: string;
  autoDeploy: boolean | null;
  dashboardUrl: string;
  lastDeploy: RenderDeploy | null;
}

// A traffic-light level for an activity-bar section icon: green = connected/up,
// yellow = available but off/unreachable, red = a failure, grey = nothing
// configured/available.
export type DotLevel = "green" | "yellow" | "red" | "grey";

// Per-section status dots for the activity rail. Only the connection/work
// sections report; Files/Secrets/Audit have no service status.
export interface SectionStatuses {
  host: DotLevel;
  databases: DotLevel;
  docker: DotLevel;
  git: DotLevel;
  activity: DotLevel;
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
  kind: "ci" | "render" | "docker" | "integration";
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

/**
 * The GitHub account AirLock will use for a project's git remote ops + commit
 * identity. `source` is how it was chosen; `protocol` is the origin remote's
 * transport (token injection only applies to https). `account` is null when no
 * account could be resolved (no remote, or an org repo with no matching login).
 */
export interface ResolvedGithubAccount {
  account: { host: string; username: string } | null;
  source: "override" | "auto" | "none";
  protocol: "https" | "ssh" | "unknown";
}

export type Section =
  | "files"
  | "secrets"
  | "git"
  | "activity"
  | "databases"
  | "docker"
  | "host"
  | "audit"
  | "events";
export type SectionVisibility = Record<Section, boolean>;

// Auto-run `claude` in new project terminals: never / once per tab / always.
export type ClaudeAutoStart = "off" | "first" | "every";

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
 * The IDE-level page-tabs (Settings / Usage) in the project strip. App chrome,
 * not project content: both can be open at once, at most one is SHOWN.
 */
export type AppPage = "settings" | "usage";

/**
 * An IDE-control command dispatched main -> renderer over the agent:command
 * channel (the agent-commands round-trip, mirroring request_secret). The
 * terminal Claude (via the IDE-control MCP tools) drives the FOCUSED window's
 * tab/split/terminal/page-tab layout; the renderer's useAgentCommands hook runs
 * the matching store action and replies with a fresh TabsSnapshot. Every variant
 * carries only tab/terminal ids, a folder path, or a page name -- NO secret
 * value crosses.
 */
export type AgentCommand =
  | { type: "list_tabs" }
  | { type: "open_tab"; path?: string }
  | { type: "close_tab"; tabId: string }
  | { type: "switch_tab"; tabId: string }
  | { type: "split_view"; tabId?: string; anchorTabId?: string }
  | { type: "open_terminal"; tabId?: string }
  | { type: "close_terminal"; terminalId: string }
  | { type: "open_app_page"; page: AppPage }
  | { type: "close_app_page"; page: AppPage }
  | { type: "start_dev_server"; command: string; startedBy: "user" | "agent" };

/**
 * The layout metadata an IDE-control command returns: one entry per open tab
 * (its id, display name, root, whether it is focused / in the split, and its
 * terminals as {id,title}) plus the split pair and the IDE page-tab state
 * (which of Settings/Usage are open, and which is shown). Names/titles only --
 * there is deliberately NO secret value, env value, or terminal output here,
 * so these tools never widen the no-secret-value surface.
 */
export interface TabsSnapshot {
  tabs: {
    id: string;
    name: string;
    root: string | null;
    focused: boolean;
    inSplit: boolean;
    // id = the renderer/layout id (what open_terminal/close_terminal take);
    // ptyId = the pty session id (what get_terminal_tail takes; null until
    // the shell has spawned). Two id spaces exist on purpose -- expose both.
    terminals: { id: string; ptyId: string | null; title: string }[];
  }[];
  split: { a: string; b: string } | null;
  appPages: { open: AppPage[]; shown: AppPage | null };
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

export interface AnthropicStatus {
  indicator: AnthropicIndicator;
  description: string;
  updatedAt: number; // unix seconds when main last fetched it
}

export interface UpdateStatus {
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  htmlUrl: string | null;
  dmgUrl: string | null;
}

export type UpdateProgress =
  | { phase: "idle" }
  | { phase: "downloading"; percent: number }
  | { phase: "mounting" }
  | { phase: "swapping" }
  | { phase: "relaunching" }
  | { phase: "revealed" }
  | { phase: "error"; message: string };

// At-a-glance app info for the Settings → About tab. Read-only; never carries
// the MCP bearer token (only the loopback port, which is not a secret).
export interface AppInfo {
  version: string;
  mcpPort: number | null;
}

// IPC-safe projection of agent-core's ExternalTerminal (which carries a non-serializable launch fn).
export interface ExternalTerminalInfo {
  id: string;
  name: string;
}

// Renderer-safe terminal display names. The renderer must NOT import the
// agent-core barrel for a value (it pulls native deps like @napi-rs/keyring
// into the browser bundle and breaks the build), so this small map lives here
// in the shared (no-native-deps) module. Keep in sync with KNOWN_TERMINALS in
// agent-core/terminal/externalTerminals.ts (the source of truth).
export const TERMINAL_DISPLAY_NAMES: Record<string, string> = {
  terminal: "Terminal",
  iterm2: "iTerm",
  ghostty: "Ghostty",
  warp: "Warp",
  alacritty: "Alacritty",
  kitty: "kitty",
  wezterm: "WezTerm",
};

/** One Claude subscription usage window (5-hour or 7-day). */
export interface QuotaWindow {
  usedPercentage: number; // 0-100
  resetsAt: number; // Unix epoch seconds
  // Synthesized by the tracker when the prior window expired with no fresh
  // emit yet: usedPercentage is 0 and resetsAt is the OLD window's end (the
  // next window starts on the user's next message, so its reset time is
  // unknowable). Consumers must show "starts on next use", not a countdown.
  awaitingNextWindow?: true;
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

// Restorable layout snapshot, persisted to session.json. Keyed by project ROOT
// (tab ids are regenerated on restore). Value-free: roots + booleans only.
export interface SessionSnapshot {
  version: 1;
  tabs: { root: string; hadClaude: boolean }[]; // array order = strip order
  activeRoot: string | null;
  split: { a: string; b: string } | null; // project roots of the side-by-side pair
}

/**
 * App-global preferences (userData JSON) - distinct from per-project config
 * and the keychain. Defined here as the single source of truth so both the
 * main-process store (prefs.ts) and the renderer (via AirlockApi) share it.
 */
export interface AppPrefs {
  sidebarVisible: boolean;
  sidebarPosition: "left" | "right";
  sidebarWidth: number; // app-global; px width of the one shared sidebar column
  theme: "dark" | "light";
  sectionVisibility: SectionVisibility; // app-global; default all true
  activeView: Section; // app-global; the sidebar view the activity bar shows
  clipboardClearSeconds: number; // app-global; 0 = never auto-clear the clipboard
  openProjectsAsTabs: boolean; // app-global; true = open folders as tabs, false = separate windows
  showRunningProcessNotice: boolean; // app-global; show the kept-busy-terminal notice when opening a folder
  recentFolders: string[]; // app-global; most-recent-first, capped, deduped
  agentPolicy: AgentCommandPolicy; // per-category gate for agent run_command
  // Claude subscription usage meter. ON by default; installs a chained Claude
  // Code statusLine that AirLock reads (set enabled:false to turn it off and
  // remove the statusLine). App-global.
  quotaMeter: { enabled: boolean };
  // Auto-install the Claude "run the app" routing skill (steers Claude to the
  // managed dev server). Default on; toggled in Settings -> Claude.
  runAppSkill: { enabled: boolean };
  // Event log display. ON by default at "debug" level (shows all events).
  // minLevel filters which events are shown; "error" = only errors. App-global.
  eventLog: { enabled: boolean; minLevel: Level };
  // Auto-run `claude` in newly created PROJECT terminals. "first" = only when
  // no other terminal in the tab holds the auto-Claude claim; blank tabs are
  // always exempt. App-global.
  claudeAutoStart: ClaudeAutoStart;
  // App-global: which terminal "open a terminal" uses. "airlock" = the
  // integrated terminal (default); otherwise a KNOWN_TERMINALS id -> that
  // external app is launched at the project folder instead of an embedded pane.
  defaultTerminal: string;
  restoreSession: boolean; // restore open projects + resume chats on launch
  // Local MCP server identity (HTTP port + bearer token). Optional: absent on
  // first run and generated/persisted by mcp/config.ensureMcpConfig so the
  // registered Claude Code URL stays stable across launches. Never exposed to
  // the renderer beyond this shared type (the token must not reach the UI).
  mcp?: { port: number; token: string };
  // Random 32-hex salt generated once on first run and persisted. Used to derive
  // per-project URL path tokens for the session-scoped MCP endpoints. Optional:
  // absent until first needed; never exposed to the renderer (stays main-only).
  installSalt?: string;
}

// One Claude session's usage, parsed from its latest statusLine emit (the
// side-channel the quota meter already taps). Account-wide truth lives in
// QuotaStatus; this is the per-session/per-model breakdown the Usage
// dashboard shows.
export interface SessionUsage {
  sessionId: string;
  // The session's CURRENT model (its latest emit). Cumulative cost/apiMs is
  // booked to this one in the by-model breakdown -- see modelsSeen.
  model: string | null;
  cwd: string | null;
  // Every distinct model display-name observed across this session's emits, in
  // first-seen order. A single session can switch models (/model, fast mode),
  // but the statusLine reports only ONE cumulative cost -- it can't be split
  // per model -- so by-model COUNTS a session under each model here while its
  // cost stays on `model` (the latest). Incomplete by nature: only models we
  // captured an emit for appear (we can't recover a session's past models).
  modelsSeen: string[];
  // POINT-IN-TIME, not cumulative: since Claude Code 2.1.132 the statusLine's
  // context_window.total_* reports the CURRENT context (occupancy as of the
  // most recent API response). Never sum these across sessions.
  contextTokens: number;
  contextWindowSize: number; // 0 when the payload doesn't report it
  // Cumulative for the session (from the payload's `cost` block):
  costUsd: number;
  apiMs: number;
  linesAdded: number;
  linesRemoved: number;
  lastEmitAt: number; // epoch s of the emit (file mtime)
  // Epoch s of the most recent emit at which a cumulative WORK metric
  // (cost/apiMs/lines) actually INCREASED -- i.e. the session did something,
  // not just re-emit a stale snapshot on its refresh timer. "Active" in the UI
  // means this is recent; an open-but-idle (or forked/background) session that
  // keeps emitting unchanged numbers correctly reads as idle. Seeded to the
  // first sighting's emit time.
  lastProgressAt: number;
}

// Payload of the overview:get IPC. profile is always present (computed live);
// summary is the .airlock/overview.md text or null; summaryMtimeMs is its mtime
// (0 when absent) so the renderer can detect a fresh write while polling.
export interface OverviewStats {
  fileCount: number; // total source files (bounded walk; deps/build/caches skipped)
  languages: { id: string; name: string; files: number }[]; // top langs + "Other"
}

export interface OverviewResult {
  profile: ProjectProfile;
  summary: string | null;
  summaryMtimeMs: number;
  stats: OverviewStats;
  readme: string | null; // project README.md content (capped), or null if absent
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
  // Restore: read the persisted layout snapshot (null = none). sessionSave sends
  // the current snapshot to main (debounced by the renderer); main writes it and
  // keeps the latest for the synchronous quit flush. Value-free (roots+booleans).
  sessionGet(): Promise<SessionSnapshot | null>;
  sessionSave(snap: SessionSnapshot): void;
  openFile(): Promise<string | null>;
  onMenuAction(cb: (a: MenuAction) => void): () => void;
  // Per-project methods below take a leading `root` (the calling pane's): two
  // panes share one window, so the window root alone is ambiguous. Main accepts
  // it only if it is a root the user opened in this window, else falls back to
  // the window root -- single-pane callers pass their window root, so behavior
  // is identical.
  listDir(root: string, relPath: string): Promise<DirEntry[]>;
  readFile(root: string, relPath: string): Promise<FileContent>;
  // True iff relPath resolves to an existing FILE within root. Cheap stat used
  // by the terminal's Cmd+click link provider to only link paths that exist.
  exists(root: string, relPath: string): Promise<boolean>;
  // True iff an absolute path is an existing DIRECTORY. Renderer-only, used by
  // session restore to skip saved project roots that no longer exist. NOT
  // root-gated and NOT an MCP/agent tool: the path comes from our own
  // session.json (no relPath join -> no path-traversal vector).
  dirExists(path: string): Promise<boolean>;
  // True iff `claude --continue` in `root` has a conversation to resume (stats
  // only ~/.claude/projects). Best-effort: returns false on any error so callers
  // always fall back to a fresh claude (the safe direction).
  hasResumableSession(root: string): Promise<boolean>;
  // Save edited text back to a workspace file (GUI editor autosave). Pane-scoped
  // by root; a USER action, never an MCP tool (the agent stays value-blind).
  writeFile(root: string, relPath: string, content: string): Promise<void>;
  // Read a (raster) image as a data URL for inline preview. Over ~25 MB --
  // { dataUrl: "", tooLarge: true } (the UI offers Open Externally).
  readImageDataUrl(
    root: string,
    relPath: string,
  ): Promise<{ dataUrl: string; tooLarge: boolean }>;
  // Inline a PDF as a data: URL (Chromium viewer). tooLarge => offer Open Externally.
  readPdfDataUrl(
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
  getPathForFile(file: File): string;
  importExternal(
    root: string,
    destRel: string,
    srcPaths: string[],
  ): Promise<ImportExternalResult>;
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
  // root = the PANE's project root (null for a blank tab -> spawn in $HOME,
  // no secret injection). Passed explicitly so main never falls back to the
  // window root, which can lag behind tab switches at spawn time.
  ptyCreate(cols: number, rows: number, root: string | null): Promise<string>;
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
    deleteAfter: boolean,
  ): Promise<EnvFileImport[]>;
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
  eventsQuery(filter: EventFilter): Promise<LogEvent[]>;
  gitIsRepo(root: string): Promise<boolean>;
  gitStatus(root: string): Promise<GitStatus>;
  gitStage(root: string, paths: string[]): Promise<void>;
  gitUnstage(root: string, paths: string[]): Promise<void>;
  gitCommit(root: string, message: string): Promise<CommitOutcome>;
  // Discard local changes: untracked=true removes the files, else restores them
  // to HEAD (index + worktree). Destructive; the UI confirms first.
  gitDiscard(root: string, paths: string[], untracked: boolean): Promise<void>;
  // Undo the last commit, keeping its changes staged (soft reset).
  gitUncommit(root: string): Promise<void>;
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
  // Per-project GitHub account: which account a project resolves to, and a
  // setter to persist (or clear, with null) a manual override.
  resolveGithubAccount(root: string): Promise<ResolvedGithubAccount>;
  setProjectGithubAccount(
    root: string,
    account: { host: string; username: string } | null,
  ): Promise<void>;
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
  // Neon: REST-backed, MULTI-ACCOUNT. A pool of accounts (each an API key, keyed
  // by Neon user id) lives main-side; each project binds to one. Data reads
  // resolve the focused project's account, so a project shows only its account's
  // orgs/projects. Keys cross IPC only on neonAddAccount; everything else is
  // ids/labels/metadata. status/resolveAccount reflect the FOCUSED project.
  neonStatus(): Promise<{ connected: boolean }>;
  neonAccounts(): Promise<NeonAccountRef[]>;
  neonResolveAccount(): Promise<NeonAccountRef | null>;
  neonAddAccount(key: string): Promise<NeonAccountRef>;
  neonSetProjectAccount(id: string): Promise<void>;
  neonRemoveAccount(id: string): Promise<void>;
  // Organizations the resolved account belongs to (the top tree level).
  neonOrgs(): Promise<NeonOrg[]>;
  neonProjects(orgId: string): Promise<NeonProject[]>;
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
  // Recent deploys for one service (lazy, on row expand). Carries no secrets.
  renderDeploys(serviceId: string): Promise<RenderDeploy[]>;
  // Trigger a new deploy of a service (owner-initiated; the UI confirms first).
  renderDeploy(serviceId: string): Promise<void>;
  // Env vars of one Render service: KEYS only (no values). Refetches live.
  renderEnvKeys(serviceId: string): Promise<string[]>;
  // OWNER-ONLY single value, audited. Agent has no equivalent tool.
  renderEnvReveal(serviceId: string, key: string): Promise<string | null>;
  // Value-free dev↔prod diff (equal/differs/only-a/only-b; no values).
  renderEnvCompare(
    serviceIdA: string,
    serviceIdB: string,
  ): Promise<EnvDiffEntry[]>;
  // Activity: aggregated in-progress operations (CI + Render + Docker) for the
  // Activity panel. NOT root-gated; CI is skipped when no folder is open.
  // activityDismiss hides an entry by id (app-global, in-memory) and broadcasts
  // activity:changed to all windows; a new run/deploy (new id) reappears.
  // Per-project feed for the PANE's root (CI is repo-gated; docker/render are
  // global). null = blank pane -> global items only.
  activityStatus(root: string | null): Promise<ActivityItem[]>;
  activityDismiss(id: string): Promise<void>;
  integrationsSteady(): Promise<SteadyIntegration[]>;
  onActivityChanged(cb: () => void): () => void;
  // Host/local dev server: hostProbe + hostOpenExternal are global; hostLocalUrl
  // is per-project (config.devUrl, else guessed). hostOpenExternal opens only
  // http(s) URLs in the system browser.
  hostLocalUrl(root: string): Promise<string | null>;
  // Common dev ports that are listening but not attributable to this project's
  // terminals and not the managed server's port. Value-free (port numbers only).
  // Gated: only when cfg.devCommand is set AND cfg.devUrl is unset.
  hostUnverifiedServers(root: string): Promise<number[]>;
  hostProbe(url: string): Promise<{ up: boolean }>;
  hostOpenExternal(url: string): Promise<void>;
  // Managed dev server: main-side manager owns lifecycle (start/stop/register).
  // devServerStart is the primary entry: it either starts or returns needsCommand
  // (unset cfg.devCommand). devServerSetCommand persists a chosen command then
  // starts. devServerRegister is called by the renderer AFTER the dev terminal's
  // pty adopts -- it moves state from pre-start to "starting".
  devServerStatus(root: string): Promise<DevServerState>;
  devServerStart(root: string): Promise<DevServerStartResult>;
  devServerSetCommand(
    root: string,
    command: string,
  ): Promise<DevServerStartResult>;
  devServerStop(root: string): Promise<DevServerState>;
  // Called by the renderer AFTER it opens the dev terminal and its pty adopts.
  devServerRegister(
    root: string,
    terminalId: string,
    ptyId: string,
    command: string,
    startedBy: "user" | "agent",
  ): Promise<DevServerState>;
  onDevServerChanged(
    cb: (e: { root: string; state: DevServerState }) => void,
  ): () => void;
  // Detect an unmanaged (user-run) dev server attributable to this project's
  // terminals. Returns port + owning ptyId, or null if none detected.
  devServerDetectUnmanaged(root: string): Promise<DetectedDevServer | null>;
  // Docker: machine-global (NOT root-gated); ids are opaque container ids.
  dockerList(): Promise<{
    installed: boolean;
    running: boolean;
    containers: Container[];
  }>;
  dockerStart(id: string): Promise<void>;
  dockerStop(id: string): Promise<void>;
  // Traffic-light status per service section for the activity-rail dots. One
  // aggregate read (main fans out to docker/db/host/git/activity).
  sectionStatuses(root: string | null): Promise<SectionStatuses>;
  prefsGet(): Promise<AppPrefs>;
  prefsSet(patch: Partial<AppPrefs>): Promise<AppPrefs>;
  listExternalTerminals(): Promise<ExternalTerminalInfo[]>;
  openExternalTerminal(root: string): Promise<void>;
  // Claude quota meter: last-known account usage (null before the first emit),
  // pushed live on quota:changed.
  quotaGet(): Promise<QuotaStatus | null>;
  // Per-session usage ledger (since launch) for the Usage dashboard.
  usageGet(): Promise<SessionUsage[]>;
  // Project overview: live tech-stack profile + optional .airlock/overview.md summary.
  overviewGet(root: string): Promise<OverviewResult>;
  onQuotaChanged(cb: (s: QuotaStatus) => void): () => void;
  anthropicStatusGet(): Promise<AnthropicStatus | null>;
  onAnthropicStatusChanged(cb: (s: AnthropicStatus) => void): () => void;
  appInfo(): Promise<AppInfo>;
  updateGet(): Promise<UpdateStatus | null>;
  onUpdateChanged(cb: (s: UpdateStatus) => void): () => void;
  updateApply(): Promise<void>;
  onUpdateProgress(cb: (p: UpdateProgress) => void): () => void;
  onSecretsChanged(cb: (root: string) => void): () => void;
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
    cb: (p: {
      requestId: string;
      name: string;
      providerHint?: string;
      root: string | null;
      projectName: string | null;
    }) => void,
  ): () => void;
  requestSecretResolve(requestId: string, vaulted: boolean): Promise<void>;
  // Agent-requested terminal input: main pushes agent:terminal-grant-request when
  // the send_terminal_input MCP tool asks to type into a live terminal. The
  // renderer opens the approval modal, then reports allow/deny via
  // terminalGrantResolve. Only a boolean crosses back -- no terminal output, no
  // secret. `preview` is the agent's own input (never a vault value).
  onTerminalGrantRequest(
    cb: (p: {
      requestId: string;
      ptyId: string;
      label: string;
      preview: string;
    }) => void,
  ): () => void;
  terminalGrantResolve(requestId: string, granted: boolean): Promise<void>;
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
  lspReferences(
    root: string,
    relPath: string,
    line: number,
    character: number,
  ): Promise<ReferenceResults>;
}
