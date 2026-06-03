// The ONLY import path for consumers. Spec §4: app imports this surface;
// nothing imports agent-core internals.
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
