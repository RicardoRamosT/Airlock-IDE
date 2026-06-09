// ASCII-only by design: this file is CJS-bundled into Electron main and
// Electron's cjs_lexer crashes on multibyte chars, so no smart punctuation in
// any regex, string literal, or comment in this file.
import { spawn } from "node:child_process";
import { appendAudit } from "../audit/audit";
import { getSecretValue, listSecrets } from "../broker/broker";
import { isDangerousEnvName } from "../broker/dangerous";
import type { KeychainStore } from "../broker/keychain";
import { redactSecrets } from "../redact/redact";

export interface CommandRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
}

export interface CommandRunner {
  run(
    command: string,
    opts: {
      cwd: string;
      env: Record<string, string>;
      timeoutMs: number;
      maxBytes: number;
    },
  ): Promise<CommandRunResult>;
}

// Real adapter: sh -c <command>, capture both streams up to maxBytes, kill the
// process group on timeout and return the partial output. This is the untested
// edge (like systemKeychain / withDb); runCommand's logic is unit-tested with a
// fake runner so the spawn itself stays out of the test matrix.
export const realRunner: CommandRunner = {
  run(command, { cwd, env, timeoutMs, maxBytes }) {
    return new Promise((resolve) => {
      // detached so the child gets its own process group; on timeout we kill the
      // WHOLE group (negative pid) so grandchildren do not outlive the command.
      const child = spawn("sh", ["-c", command], { cwd, env, detached: true });
      let stdout = "";
      let stderr = "";
      let truncated = false;
      let timedOut = false;
      const cap = (buf: string, chunk: Buffer): string => {
        if (buf.length >= maxBytes) {
          truncated = true;
          return buf;
        }
        const next = buf + chunk.toString("utf8");
        if (next.length > maxBytes) {
          truncated = true;
          return next.slice(0, maxBytes);
        }
        return next;
      };
      child.stdout?.on("data", (c: Buffer) => {
        stdout = cap(stdout, c);
      });
      child.stderr?.on("data", (c: Buffer) => {
        stderr = cap(stderr, c);
      });
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        } catch {
          // already gone
        }
      }, timeoutMs);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code, timedOut, truncated });
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: null, timedOut, truncated });
      });
    });
  },
};

export interface RunCommandOptions {
  injectSecrets?: string[];
  cwd?: string;
  baseEnv?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  keychain?: KeychainStore;
  runner?: CommandRunner;
}

export interface RunCommandResult {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BYTES = 256 * 1024;

// Resolve named vaulted secrets main-side, inject them into a child process env,
// run the command, REDACT every injected value out of the captured output, and
// audit the run. The agent USES the secret; it never SEES it. Fail-closed: a
// requested secret that is not vaulted blocks the run (the NAME is safe to
// surface in the error; a value never is).
export async function runCommand(
  root: string,
  command: string,
  opts: RunCommandOptions = {},
): Promise<RunCommandResult> {
  const runner = opts.runner ?? realRunner;
  const names = opts.injectSecrets ?? [];
  // Redaction set: EVERY vaulted value, not just the injected subset. Any vaulted
  // secret can surface in the output via the inherited env (e.g. `printenv` on a
  // command that injects nothing), so the redactor must scrub all of them. This
  // mirrors the PTY-tail redaction path. (audit C1/H1)
  const values: string[] = [];
  const seen = new Set<string>();
  const addValue = (v: string): void => {
    if (!seen.has(v)) {
      seen.add(v);
      values.push(v);
    }
  };
  const valueByName = new Map<string, string>();
  for (const meta of await listSecrets(root)) {
    const v = await getSecretValue(root, meta.name, {
      keychain: opts.keychain,
    });
    if (v !== null) {
      valueByName.set(meta.name, v);
      addValue(v);
    }
  }
  // Inject only the NAMED secrets. Resolve any not covered by the meta scan (a
  // reserved name can be seeded directly in the keychain with no meta entry).
  const injectedEnv: Record<string, string> = {};
  const blocked: string[] = [];
  for (const name of names) {
    const value =
      valueByName.get(name) ??
      (await getSecretValue(root, name, { keychain: opts.keychain }));
    if (value == null) {
      // Fail-closed: never run a command that asked for a secret we do not have.
      await appendAudit(root, "agent", "command.run.blocked", {
        command,
        missing: name,
      });
      throw new Error(`requested secret not vaulted: ${name}`);
    }
    addValue(value);
    if (isDangerousEnvName(name)) {
      blocked.push(name);
      continue;
    }
    injectedEnv[name] = value;
  }
  const env = {
    ...(process.env as Record<string, string>),
    ...(opts.baseEnv ?? {}),
    ...injectedEnv,
  };
  const res = await runner.run(command, {
    cwd: opts.cwd ?? root,
    env,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES,
  });
  const combined = res.stderr ? `${res.stdout}\n${res.stderr}` : res.stdout;
  const output = redactSecrets(combined, values);
  await appendAudit(root, "agent", "command.run", {
    command,
    names: Object.keys(injectedEnv),
    blocked,
    exitCode: res.exitCode,
    timedOut: res.timedOut,
    truncated: res.truncated,
  });
  return {
    output,
    exitCode: res.exitCode,
    timedOut: res.timedOut,
    truncated: res.truncated,
  };
}
