import type {
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
  SecretMeta,
} from "@airlock/agent-core";

export type {
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
  SecretMeta,
};

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
 * App-global preferences (userData JSON) - distinct from per-project config
 * and the keychain. Defined here as the single source of truth so both the
 * main-process store (prefs.ts) and the renderer (via AirlockApi) share it.
 */
export interface AppPrefs {
  sidebarVisible: boolean;
  sidebarPosition: "left" | "right";
  theme: "dark" | "light";
  sectionVisibility: SectionVisibility; // app-global; default all true
  // Local MCP server identity (HTTP port + bearer token). Optional: absent on
  // first run and generated/persisted by mcp/config.ensureMcpConfig so the
  // registered Claude Code URL stays stable across launches. Never exposed to
  // the renderer beyond this shared type (the token must not reach the UI).
  mcp?: { port: number; token: string };
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
  listDir(relPath: string): Promise<DirEntry[]>;
  readFile(relPath: string): Promise<FileContent>;
  ptyCreate(cols: number, rows: number): Promise<string>;
  ptyInput(id: string, data: string): void;
  ptyResize(id: string, cols: number, rows: number): void;
  ptyKill(id: string): void;
  onPtyData(cb: (e: PtyDataEvent) => void): () => void;
  onPtyExit(cb: (e: PtyExitEvent) => void): () => void;
  secretsList(): Promise<SecretMeta[]>;
  secretsSet(name: string, value: string): Promise<SecretMeta>;
  secretsDelete(name: string): Promise<void>;
  secretsImportEnv(
    relPath: string,
    deleteAfter: boolean,
  ): Promise<ImportResult>;
  configGet(): Promise<ProjectConfig>;
  configSet(patch: Partial<ProjectConfig>): Promise<ProjectConfig>;
  auditRead(limit: number): Promise<AuditEntry[]>;
  gitIsRepo(): Promise<boolean>;
  gitStatus(): Promise<GitStatus>;
  gitStage(paths: string[]): Promise<void>;
  gitUnstage(paths: string[]): Promise<void>;
  gitCommit(message: string): Promise<string>;
  gitBranches(): Promise<string[]>;
  gitSwitchBranch(name: string): Promise<void>;
  gitCreateBranch(name: string): Promise<void>;
  gitFileVersions(relPath: string, which: DiffSide): Promise<FileVersions>;
  githubInfo(): Promise<GithubInfo>;
  githubSwitch(host: string, username: string): Promise<void>;
  // Databases: id is the secret NAME; no password ever crosses these. dbList
  // returns redacted projections; ping/tables/rows return data or a
  // message-only error -- never the connection string.
  dbList(): Promise<DbEntry[]>;
  dbPing(id: string): Promise<{ ok: boolean; error?: string }>;
  dbTables(id: string): Promise<DbTable[]>;
  dbRows(
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
  activityStatus(): Promise<ActivityItem[]>;
  // Host/local dev server: hostProbe + hostOpenExternal are global; hostLocalUrl
  // is per-project (config.devUrl, else guessed). hostOpenExternal opens only
  // http(s) URLs in the system browser.
  hostLocalUrl(): Promise<string | null>;
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
  setSectionVisibility(
    id: Section,
    visible: boolean,
  ): Promise<SectionVisibility>;
  onSectionsChanged(cb: (v: SectionVisibility) => void): () => void;
  // Agent-requested secret: main pushes agent:request-secret when the
  // request_secret MCP tool asks the user to vault a secret. The renderer opens
  // the secure modal, then reports the outcome via requestSecretResolve. ONLY a
  // boolean crosses back -- the value goes user -> keychain via secretsSet; the
  // agent never sees it.
  onRequestSecret(
    cb: (p: { requestId: string; name: string; providerHint?: string }) => void,
  ): () => void;
  requestSecretResolve(requestId: string, vaulted: boolean): Promise<void>;
}
