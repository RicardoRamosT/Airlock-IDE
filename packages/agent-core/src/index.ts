// The ONLY import path for consumers. Spec S4: app imports this surface;
// nothing imports agent-core internals.

export {
  type AuditEntry,
  appendAudit,
  readAudit,
  verifyAuditChain,
} from "./audit/audit";
export {
  type BrokerOptions,
  deleteSecret,
  type ImportResult,
  type InjectResult,
  importDotEnv,
  injectInto,
  listSecrets,
  setSecret,
} from "./broker/broker";
export {
  type DangerousEnvResult,
  filterDangerousEnv,
  isDangerousEnvName,
} from "./broker/dangerous";
export { parseDotEnv } from "./broker/dotenv";
export { type KeychainStore, systemKeychain } from "./broker/keychain";
export type { SecretMeta } from "./broker/meta";
export {
  type ValidationResult,
  validateSecret,
  validateSecretName,
} from "./broker/validators";
export { withDb } from "./db/client";
export { type DbInfo, parseConnString } from "./db/connstr";
export {
  type DbRunner,
  type DbTable,
  listTables,
  pingDb,
  type QueryResult,
  readRows,
} from "./db/explorer";
export {
  commitStaged,
  createBranch,
  listBranches,
  stageFiles,
  switchBranch,
  unstageFiles,
} from "./git/ops";
export { isGitRepo, runGit } from "./git/run";
export {
  type BranchInfo,
  type FileChange,
  type GitStatus,
  gitStatus,
  parsePorcelainV2,
} from "./git/status";
export {
  type DiffSide,
  type FileVersions,
  gitFileVersions,
} from "./git/versions";
export {
  type GhAccount,
  type GhStatus,
  ghAccounts,
  parseGhAuthStatus,
  switchGhAccount,
} from "./github/accounts";
export {
  type ProjectConfig,
  readProjectConfig,
  writeProjectConfig,
} from "./project/config";
export { projectIdFor } from "./project/id";
export { captureLoginEnv, loginShell } from "./pty/login-env";
export {
  createPtySession,
  type IDisposable,
  type PtyOptions,
  PtySession,
} from "./pty/session";
export {
  type FileContent,
  MAX_FILE_BYTES,
  readWorkspaceFile,
} from "./workspace/read";
export { type DirEntry, listDirectory, resolveWithin } from "./workspace/tree";
