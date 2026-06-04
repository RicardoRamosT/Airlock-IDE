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
  | "databases"
  | "docker"
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
}
