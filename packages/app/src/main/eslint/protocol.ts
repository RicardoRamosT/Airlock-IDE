// protocol.ts -- the wire between main and resources/eslint-worker.mjs:
// newline-delimited JSON over the worker's stdio, one object per line.
import type { EslintLintMessage } from "../../shared/ipc";

// Defined once in shared/ipc.ts (the renderer needs it too); aliased here so
// the two ends of the wire cannot drift apart.
export type EslintMessage = EslintLintMessage;

export interface WorkerRequest {
  id: number;
  op: "lint";
  filePath: string; // absolute; ESLint matches config globs against it
  text: string; // the live buffer, not what is on disk
}

export type WorkerResponse =
  | { id: number; messages: EslintMessage[] }
  | { id: number; configError: string };

// A line splitter that buffers across chunks: a large response reaches the
// pipe in several reads, and a line is only a message once its "\n" arrives.
export function splitLines(): (chunk: string) => string[] {
  let buf = "";
  return (chunk) => {
    buf += chunk;
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    return parts.filter((l) => l.trim() !== "");
  };
}
