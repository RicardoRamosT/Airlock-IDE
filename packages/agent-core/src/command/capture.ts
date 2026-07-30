// ASCII-only by design: this file is CJS-bundled into Electron main and
// Electron's cjs_lexer crashes on multibyte chars, so no smart punctuation in
// any regex, string literal, or comment in this file.
//
// Run a command and put its stdout in the SESSION secret store instead of in the
// return value. This is the only path by which a MACHINE-FETCHED credential (a
// prod URL held by Azure, say) can reach a later command without its value
// passing through a tool result -- and therefore the transcript. The agent USES
// the value; it never SEES it.
import { appendAudit } from "../audit/audit";
import type { KeychainStore } from "../broker/keychain";
import { putSessionSecret } from "../broker/session";
import {
  type CommandRunner,
  DEFAULT_TIMEOUT_MS,
  prepareRun,
  realRunner,
} from "./run";

export interface CaptureSecretResult {
  captured: boolean;
  name: string;
  exitCode: number | null;
  bytes?: number;
  timedOut?: boolean;
  truncated?: boolean;
  stderr?: string;
  reason?: string;
}

// A credential past this is not a credential. Refuse rather than truncate: a
// silently cut value fails confusingly hours later.
export const MAX_SECRET_BYTES = 8 * 1024;
// Enough for any credential, far below runCommand's 256KB, so an accidental
// firehose is refused cheaply.
const CAPTURE_MAX_BYTES = 64 * 1024;

export interface CaptureSecretOptions {
  injectSecrets?: string[];
  cwd?: string;
  baseEnv?: Record<string, string>;
  timeoutMs?: number;
  keychain?: KeychainStore;
  runner?: CommandRunner;
}

export async function captureSecret(
  root: string,
  command: string,
  name: string,
  opts: CaptureSecretOptions = {},
): Promise<CaptureSecretResult> {
  const runner = opts.runner ?? realRunner;
  const p = await prepareRun(root, command, opts.injectSecrets ?? [], opts);
  const res = await runner.run(command, {
    cwd: p.resolvedCwd,
    env: p.env,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: CAPTURE_MAX_BYTES,
  });
  const value = res.stdout.trim();
  const bytes = Buffer.byteLength(value, "utf8");
  putSessionSecret(root, name, value, command);
  await appendAudit(root, "agent", "secret.capture", {
    name,
    bytes,
    command,
    cwd: p.resolvedCwd,
    names: p.injectedNames,
    exitCode: res.exitCode,
  });
  return { captured: true, name, bytes, exitCode: res.exitCode };
}
