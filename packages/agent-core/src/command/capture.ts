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
import { getSecretValue } from "../broker/broker";
import { isDangerousEnvName } from "../broker/dangerous";
import type { KeychainStore } from "../broker/keychain";
import { putSessionSecret } from "../broker/session";
import { validateSecretName } from "../broker/validators";
import { redactSecrets } from "../redact/redact";
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
// Cap on the redacted stderr returned to the agent on a failed capture --
// enough for a real diagnostic, far below CAPTURE_MAX_BYTES.
const STDERR_CAP = 2 * 1024;

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
  const refuse = (reason: string): CaptureSecretResult => ({
    captured: false,
    name,
    exitCode: null,
    reason,
  });
  if (!validateSecretName(name)) return refuse(`invalid secret name: ${name}`);
  if (isDangerousEnvName(name))
    return refuse(`refusing to capture into a dangerous env name: ${name}`);
  // Collision with a USER-managed secret is refused outright in v1; the approval
  // click arrives with the agent request surface spec. getSecretValue (not the
  // meta list) so a reserved name seeded straight into the keychain also counts.
  if ((await getSecretValue(root, name, { keychain: opts.keychain })) !== null)
    return refuse(`name already vaulted: ${name}`);

  const runner = opts.runner ?? realRunner;
  const p = await prepareRun(root, command, opts.injectSecrets ?? [], opts);
  const res = await runner.run(command, {
    cwd: p.resolvedCwd,
    env: p.env,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: CAPTURE_MAX_BYTES,
  });
  if (res.timedOut || res.exitCode !== 0) {
    await appendAudit(root, "agent", "secret.capture.failed", {
      name,
      command,
      exitCode: res.exitCode,
      timedOut: res.timedOut,
    });
    return {
      captured: false,
      name,
      exitCode: res.exitCode,
      timedOut: res.timedOut,
      truncated: res.truncated,
      // The ONE place output can flow. Redacted against every known value and
      // capped: a failed fetch prints a diagnostic, and an opaque failure would
      // send the agent back to asking the user to run commands by hand.
      stderr: redactSecrets(res.stderr, p.values).slice(0, STDERR_CAP),
      reason: res.timedOut
        ? "command timed out"
        : `command exited ${res.exitCode}`,
    };
  }
  // Post-run refusals still need an audit record. A command that runs to
  // completion and produces nothing usable (empty output, truncated output, an
  // oversized value) would otherwise be a no-trace way to execute a command:
  // secret.capture only fires on success and secret.capture.failed (above) only
  // on timeout/non-zero exit, so none of these three ever wrote anything. That
  // silence is the more dangerous path, not a minor gap -- runCommand audits
  // command.run unconditionally, and this must not be the quiet exception.
  const refuseAfterRun = async (
    reason: string,
  ): Promise<CaptureSecretResult> => {
    await appendAudit(root, "agent", "secret.capture.failed", {
      name,
      command,
      exitCode: res.exitCode,
      timedOut: res.timedOut,
      truncated: res.truncated,
      reason,
    });
    return { captured: false, name, exitCode: res.exitCode, reason };
  };
  if (res.truncated)
    return refuseAfterRun(
      "output was truncated -- refusing to store a partial secret",
    );
  const value = res.stdout.trim();
  if (value.length === 0) return refuseAfterRun("command produced no output");
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > MAX_SECRET_BYTES)
    return refuseAfterRun(
      `captured value too large: ${bytes} bytes (max ${MAX_SECRET_BYTES})`,
    );
  // Audit BEFORE the value becomes retrievable. If appendAudit throws (a disk
  // write failure, say), putSessionSecret never runs, so we fail closed with
  // nothing stored rather than leaving a live, unaudited credential sitting in
  // the session store -- exactly the state this feature's audit trail exists
  // to prevent. The reverse ordering's failure mode is milder: if
  // putSessionSecret somehow threw after a successful audit write, the result
  // is a phantom audit entry for a value that was never actually stored, and
  // prepareRun's fail-closed resolution means no later command can use a name
  // that is not there -- misleading paperwork, not a live unaudited secret.
  await appendAudit(root, "agent", "secret.capture", {
    name,
    bytes,
    command,
    cwd: p.resolvedCwd,
    names: p.injectedNames,
    blocked: p.blocked,
    exitCode: res.exitCode,
  });
  putSessionSecret(root, name, value, command);
  return { captured: true, name, bytes, exitCode: res.exitCode };
}
