// The ONLY import path for consumers. Spec S4: app imports this surface;
// nothing imports agent-core internals.

export {
  type AuditEntry,
  appendAudit,
  appendAuditAt,
  readAudit,
  verifyAuditChain,
} from "./audit/audit";
export {
  type BrokerOptions,
  deleteSecret,
  getGlobalSecret,
  getSecretValue,
  type ImportResult,
  type InjectResult,
  importDotEnv,
  injectInto,
  listSecrets,
  setGlobalSecret,
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
export {
  type CommandRunner,
  type RunCommandOptions,
  type RunCommandResult,
  runCommand,
} from "./command/run";
export { withDb } from "./db/client";
export { type DbInfo, parseConnString, redactConnStrings } from "./db/connstr";
export {
  type DbRunner,
  type DbTable,
  listTables,
  pingDb,
  type QueryResult,
  readRows,
} from "./db/explorer";
export {
  type Container,
  type DockerStatus,
  dockerContainers,
  dockerStart,
  dockerStop,
  parseDockerPs,
} from "./docker/docker";
export {
  commitStaged,
  createBranch,
  headSha,
  listBranches,
  originRemoteUrl,
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
export { type CiRun, type CiStep, latestCiRun } from "./github/ci";
export { type PortProber, probePort } from "./host/probe";
export {
  type ClaudeRunner,
  type McpRegisterInput,
  type McpRegisterResult,
  registerMcpServer,
} from "./mcp/register";
export {
  fetchTransport,
  // Aliased: agent-core already exports a git listBranches (./git/ops) with a
  // different signature; this is the Neon REST one.
  listBranches as neonListBranches,
  listDatabases as neonListDatabases,
  listProjects as neonListProjects,
  type NeonBranch,
  type NeonDatabase,
  type NeonOptions,
  type NeonProject,
  type NeonTransport,
  neonConnectionUri,
} from "./neon/client";
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
// Scrubs injected secret values + secret-shaped strings out of command output
// before the agent sees it (companion to redactConnStrings above).
export { redactSecrets } from "./redact/redact";
export {
  // Aliased (same precedent as the Neon block): the Render REST functions are
  // render-prefixed to avoid clashing with other agent-core exports.
  latestDeploy as renderLatestDeploy,
  listServices as renderListServices,
  type RenderDeploy,
  type RenderOptions,
  type RenderService,
  type RenderTransport,
  renderFetchTransport,
} from "./render/client";
export { normalizeRepoUrl } from "./render/parse";
export { redactedPreview, redactedTail } from "./terminal/tail";
export {
  type FileContent,
  MAX_FILE_BYTES,
  readWorkspaceFile,
} from "./workspace/read";
export { type DirEntry, listDirectory, resolveWithin } from "./workspace/tree";
