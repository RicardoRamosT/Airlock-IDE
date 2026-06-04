// The ONLY import path for consumers. Spec §4: app imports this surface;
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
  type ProjectConfig,
  readProjectConfig,
  writeProjectConfig,
} from "./project/config";
export { projectIdFor } from "./project/id";
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
