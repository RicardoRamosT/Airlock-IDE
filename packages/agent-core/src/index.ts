// The ONLY import path for consumers. Spec S4: app imports this surface;
// nothing imports agent-core internals.

export {
  type AnthropicIndicator,
  type AnthropicStatusTransport,
  anthropicStatusFetchTransport,
  fetchAnthropicStatus,
  type ParsedAnthropicStatus,
} from "./anthropicStatus/client";
export {
  type AuditEntry,
  appendAudit,
  appendAuditAt,
  readAudit,
  verifyAuditChain,
} from "./audit/audit";
export {
  type BrokerOptions,
  deleteGlobalSecret,
  deleteSecret,
  type EnvFileImport,
  getGlobalSecret,
  getSecretValue,
  type ImportResult,
  type InjectResult,
  importAllDotEnv,
  importDotEnv,
  injectInto,
  listSecrets,
  setGlobalSecret,
  setSecret,
  vaultedSecrets,
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
  claudeProjectsDirName,
  hasResumableClaudeSession,
} from "./claude/session";
export {
  type AgentCommandPolicy,
  classifyCommand,
  DEFAULT_AGENT_POLICY,
  type GateResult,
  gateCommand,
  type RiskAction,
  type RiskCategory,
} from "./command/policy";
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
export { createFileSink, type FileSinkOpts } from "./events/fileSink";
export {
  type EventFilter,
  filterEvents,
  parseEventLog,
} from "./events/query";
export { redactEvent } from "./events/redactEvent";
export {
  type EmitInput,
  LEVELS,
  type Level,
  type LogEvent,
  levelAtLeast,
} from "./events/types";
export {
  EventWriter,
  type Sink,
  type WriterOpts,
} from "./events/writer";
export { buildAuthedArgs, runGitAuthed } from "./git/auth";
export { ensureCommitIdentity, type GitIdentity } from "./git/identity";
export {
  commitStaged,
  createBranch,
  discardChanges,
  gitFetch,
  gitPull,
  gitPush,
  headSha,
  listBranches,
  originRemoteUrl,
  stageFiles,
  switchBranch,
  undoLastCommit,
  unstageFiles,
} from "./git/ops";
export { getOrigin, type ParsedRemote, parseRemote } from "./git/remote";
export { type ResolvedAccount, resolveProjectAccount } from "./git/resolve";
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
  type GhIdentity,
  type GhStatus,
  ghAccounts,
  ghToken,
  ghUserIdentity,
  parseGhAuthStatus,
  parseGhUser,
  switchGhAccount,
} from "./github/accounts";
export { type CiRun, type CiStep, latestCiRun } from "./github/ci";
export {
  COMMON_DEV_PORTS,
  excludeReservedPorts,
  FRONTEND_SUBDIRS,
  guessDevPort,
  MACOS_RESERVED_PORTS,
  pickListeningPort,
  pickUnverifiedPorts,
} from "./host/detect";
export type {
  DevServerEvent,
  DevServerState,
  DevServerStatus,
} from "./host/devserver";
export {
  devServerNextState,
  IDLE_DEV_SERVER,
  pickListeningPortFromSubtree,
  pickUnmanagedServer,
  resolveDevCommand,
} from "./host/devserver";
export { type PortProber, probePort } from "./host/probe";
export {
  CONNECTED_EXTENSIONS,
  type ConfigField,
  type ConfigSchema,
  type ConnectedExtensionDescriptor,
  type ConnectedStatus,
  connectedSummary,
  SLACK_DESCRIPTOR,
} from "./integrations/connected";
export {
  type CliRunner,
  type DetectStatus,
  detectStatus,
  isCommandMissing,
  isRelevant,
  type PollCache,
  pollIntegrations,
  pollSteady,
  type RelevanceContext,
  realRunner,
  runManifest,
  type SteadyCache,
  type SteadyIntegration,
  steadyView,
} from "./integrations/engine";
export { evalExpr } from "./integrations/expr";
export type {
  ActionSpec,
  Command,
  DetailSpec,
  IntegrationItem,
  IntegrationManifest,
  IntegrationState,
  ItemAction,
  ItemDetail,
  MapSpec,
  RelevanceSpec,
  StateSpec,
  Surface,
} from "./integrations/manifest";
export { applyState, mapToItems } from "./integrations/map";
export {
  AZURE,
  INTEGRATIONS,
  SNOWFLAKE,
  VERCEL,
} from "./integrations/registry";
export {
  buildExtensionSummaries,
  type ExtensionSummary,
  type ExtPrefs,
  enabledManifests,
  pinnedEnabledManifests,
} from "./integrations/summary";
export {
  type ClaudeRunner,
  type McpRegisterInput,
  type McpRegisterResult,
  type McpScope,
  type McpUnregisterInput,
  registerMcpServer,
  unregisterMcpServer,
} from "./mcp/register";
export {
  fetchTransport,
  getCurrentUser as neonGetCurrentUser,
  getInferredOrg as neonGetInferredOrg,
  // Aliased: agent-core already exports a git listBranches (./git/ops) with a
  // different signature; this is the Neon REST one.
  listBranches as neonListBranches,
  listDatabases as neonListDatabases,
  listOrganizations as neonListOrganizations,
  listProjects as neonListProjects,
  type NeonAccountRef,
  type NeonBranch,
  type NeonDatabase,
  type NeonOptions,
  type NeonOrg,
  type NeonProject,
  type NeonTransport,
  type NeonUser,
  neonAccountLabel,
  neonConnectionUri,
  resolveNeonAccountId,
} from "./neon/client";
export { ensureAirlockDir } from "./project/airlockDir";
export {
  type ProjectConfig,
  readProjectConfig,
  writeProjectConfig,
} from "./project/config";
export { projectIdFor } from "./project/id";
export { buildProfile, type DetectInputs } from "./project-profile/detect";
export type {
  ProjectArea,
  ProjectProfile,
  ProjectTech,
  TechCategory,
} from "./project-profile/types";
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
export { type SecretFinding, scanForSecrets } from "./redact/scan";
export {
  // Aliased (same precedent as the Neon block): the Render REST functions are
  // render-prefixed to avoid clashing with other agent-core exports.
  latestDeploy as renderLatestDeploy,
  listDeploys as renderListDeploys,
  listEnvVars as renderListEnvVars,
  listServices as renderListServices,
  type RenderDeploy,
  type RenderEnvVar,
  type RenderOptions,
  type RenderService,
  type RenderTransport,
  renderFetchTransport,
  triggerDeploy as renderTriggerDeploy,
} from "./render/client";
export {
  diffEnvVars,
  type EnvDiffEntry,
  normalizeRepoUrl,
  parseEnvVars,
  servicesForRepo,
} from "./render/parse";
export {
  authTest as slackAuthTest,
  channelHistory as slackChannelHistory,
  listChannels as slackListChannels,
  type SlackTransport,
} from "./slack/client";
export type {
  SlackAuth,
  SlackChannel,
  SlackMessage,
} from "./slack/parse";
export {
  detectInstalledTerminals,
  type ExternalTerminal,
  KNOWN_TERMINALS,
  launchArgs,
  type MdfindRunner,
  parseInstalled,
  terminalDisplayName,
} from "./terminal/externalTerminals";
export { redactedPreview, redactedTail } from "./terminal/tail";
export {
  AIRLOCK_REPO,
  fetchLatestRelease,
  type LatestRelease,
  type UpdateTransport,
  updateFetchTransport,
} from "./update/client";
export { chooseUpdateAction } from "./update/decide";
export { compareVersions, isNewer } from "./update/version";
export {
  createDir,
  createFile,
  duplicate,
  type ImportExternalResult,
  importExternal,
  move,
  uniqueName,
} from "./workspace/fileOps";
export {
  type OrderMap,
  readOrder,
  writeFolderOrder,
} from "./workspace/fileOrder";
export {
  type FileContent,
  MAX_FILE_BYTES,
  readImageDataUrl,
  readPdfDataUrl,
  readWorkspaceFile,
} from "./workspace/read";
export {
  type SearchFileResult,
  type SearchMatch,
  type SearchResults,
  searchProject,
} from "./workspace/search";
export {
  type DirEntry,
  type FileList,
  listDirectory,
  listFilesRecursive,
  resolveWithin,
  targetsVault,
} from "./workspace/tree";
export {
  type ExcelAlign,
  type ExcelCell,
  type ExcelSheet,
  readWorkbook,
  type WorkbookData,
} from "./workspace/workbook";
export { writeWorkspaceFile } from "./workspace/write";
