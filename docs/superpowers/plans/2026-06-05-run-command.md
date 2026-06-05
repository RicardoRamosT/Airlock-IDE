# run_command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a `run_command` MCP tool: the terminal Claude runs a shell command with named vaulted secrets injected by the broker, gets the output back REDACTED, and never sees the secret values. The agent USES secrets; it never HOLDS them.

**Architecture:** Two new agent-core modules + one MCP tool. `redact/` (the security-critical redactor: exact-match injected values + a pattern pack). `command/` (`runCommand(root, command, opts)`: resolve named secrets main-side via getSecretValue, build the child env = base login env + filtered injected secrets, spawn `sh -c` in a dedicated child process with timeout + output cap, redact the captured output, audit `command.run`). The MCP tool (main) is a thin wrapper that calls agent-core `runCommand` (NOT getSecretValue) so the existing source-guard stays green. Values are injected into the child env and redacted out of the output -- never returned.

**Tech Stack:** node:child_process (DI'd for tests), the existing broker (getSecretValue, filterDangerousEnv), the audit chain, the MCP SDK tool API, vitest, biome.

**Carry into every task:**
- ASCII-only comments in ALL agent-core/* and app/src/main/* files (CJS-bundled into Electron main; cjs_lexer crashes on multibyte).
- THE INVARIANT (new form for a secret-USING tool): no injected secret value ever appears in `run_command`'s returned output. `runCommand` redacts every injected value (+ pattern pack). The adversarial test: a command that echoes an injected secret must come back `***`.
- `tools.ts` must still reference NONE of getSecretValue/getGlobalSecret/neonConnectionUri/dbConnString/injectInto (the source-guard test). The `run_command` tool calls `runCommand` (agent-core), which uses getSecretValue internally -- the call site stays out of tools.ts.
- Over-redaction is SAFE (mask too much); under-redaction LEAKS. When in doubt, redact.
- Fail-closed: if a requested secret name isn't vaulted, do NOT run -- return a clean error naming the missing secret (the NAME is safe to surface; never a value).

---

### Task 1: agent-core redactor (the security core)

**Files:** Create `packages/agent-core/src/redact/redact.ts`, `redact/redact.test.ts`; modify `packages/agent-core/src/index.ts`.

- [ ] **Step 1: Failing tests (redact.test.ts)** -- cover:
  - single injected value echoed in text -> replaced with `***` (all occurrences).
  - multiple values -> all masked; a value that is a substring of another -> longest-first so both fully masked.
  - a value with regex-special chars (e.g. `p@ss.w*rd$1`) -> escaped + masked (NOT treated as a regex).
  - empty / whitespace-only value -> skipped (must NOT mask everything).
  - value split across lines / appearing 3x -> all masked.
  - pattern pack: a `postgres://user:pass@host/db` not in `values` -> userinfo redacted (via redactConnStrings); a `Bearer abcdef123456` -> token redacted.
  Run `npm test -- redact` -> RED.

- [ ] **Step 2: Implement redact.ts** (ASCII-only comments + the cjs_lexer banner):
```ts
import { redactConnStrings } from "../db/connstr";

const PLACEHOLDER = "***";

// Escape a literal string for use inside a RegExp (secret values are data, not
// patterns -- a password full of regex metachars must match literally).
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Redact secret VALUES from text before it can reach the agent. Exact-match
// every non-empty value (all occurrences) -> ***, longest-first so a value that
// contains a shorter one is fully masked. Then a defense-in-depth pattern pass
// for secret-shaped strings that were NOT in the injected set.
export function redactSecrets(text: string, values: string[]): string {
  let out = text;
  const vals = [...new Set(values)]
    .filter((v) => typeof v === "string" && v.trim().length > 0)
    .sort((a, b) => b.length - a.length);
  for (const v of vals) {
    out = out.replace(new RegExp(escapeRegExp(v), "g"), PLACEHOLDER);
  }
  // Pattern pack (defense in depth): connection-string userinfo + bearer tokens.
  out = redactConnStrings(out);
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, `$1${PLACEHOLDER}`);
  return out;
}
```
(Note: no min-length on values -- a pathologically short secret over-redacts, which is SAFE. Whitespace-only is skipped so it can't mask everything.)

- [ ] **Step 3:** export `redactSecrets` from index.ts.
- [ ] **Step 4: GREEN** -- `npm test`, typecheck, lint, build (agent-core CJS, no cjs_lexer). Commit -- `feat(redact): redactSecrets (exact-match values + pattern pack)`

---

### Task 2: agent-core runCommand (orchestration)

**Files:** Create `packages/agent-core/src/command/run.ts`, `command/run.test.ts`; modify `packages/agent-core/src/index.ts`.

- [ ] **Step 1: Failing tests (run.test.ts)** with a fake keychain (Map-backed, like broker.test.ts) + a fake `CommandRunner`:
  - injection: runCommand(root, "echo hi", { injectSecrets:["DATABASE_URL"], keychain, runner }) -> the runner received env with `DATABASE_URL` = the vaulted value, cwd = root.
  - REDACTION GUARD: the fake runner returns stdout = `"connected to <the DATABASE_URL value>"` -> runCommand's returned `output` contains `***` and does NOT contain the value. (Adversarial: also test the value appearing twice + with surrounding text.)
  - fail-closed: a requested name not in the keychain -> runCommand throws/returns a clean error naming the missing secret, the runner is NEVER called, an audit `command.run.blocked` is written with the name (no value).
  - dangerous injected name filtered: if injectSecrets includes a dangerous name (e.g. "PATH") it is NOT placed in the child env (blocked), recorded in the audit `blocked` list.
  - passthrough: exitCode / timedOut / truncated from the runner flow into the result.
  - audit: a `command.run` entry is appended with { command, names, exitCode, ... } and NO values.
  Run `npm test -- run` (scope to the new file) -> RED.

- [ ] **Step 2: Implement run.ts** (ASCII-only). The pure orchestration over a DI'd runner; the real spawn is the untested adapter (like systemKeychain/withDb):
```ts
import { spawn } from "node:child_process";
import { appendAudit } from "../audit/audit";
import { getSecretValue } from "../broker/broker";
import { isDangerousEnvName } from "../broker/dangerous";
import type { KeychainStore } from "../broker/keychain";
import { redactSecrets } from "../redact/redact";

export interface CommandRunResult {
  stdout: string; stderr: string; exitCode: number | null;
  timedOut: boolean; truncated: boolean;
}
export interface CommandRunner {
  run(command: string, opts: { cwd: string; env: Record<string, string>; timeoutMs: number; maxBytes: number }): Promise<CommandRunResult>;
}

// Real adapter: sh -c <command>, capture both streams up to maxBytes, kill the
// process group on timeout and return the partial output. Untested edge.
export const realRunner: CommandRunner = {
  run(command, { cwd, env, timeoutMs, maxBytes }) {
    return new Promise((resolve) => {
      const child = spawn("sh", ["-c", command], { cwd, env, detached: true });
      let stdout = ""; let stderr = ""; let truncated = false; let timedOut = false;
      const cap = (buf: string, chunk: Buffer) => {
        if (buf.length >= maxBytes) { truncated = true; return buf; }
        const next = buf + chunk.toString("utf8");
        if (next.length > maxBytes) { truncated = true; return next.slice(0, maxBytes); }
        return next;
      };
      child.stdout?.on("data", (c) => { stdout = cap(stdout, c); });
      child.stderr?.on("data", (c) => { stderr = cap(stderr, c); });
      const timer = setTimeout(() => {
        timedOut = true;
        try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already gone */ }
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
  injectSecrets?: string[]; cwd?: string; baseEnv?: Record<string, string>;
  timeoutMs?: number; maxBytes?: number;
  keychain?: KeychainStore; runner?: CommandRunner;
}
export interface RunCommandResult {
  output: string; exitCode: number | null; timedOut: boolean; truncated: boolean;
}

export async function runCommand(
  root: string, command: string, opts: RunCommandOptions = {},
): Promise<RunCommandResult> {
  const runner = opts.runner ?? realRunner;
  const names = opts.injectSecrets ?? [];
  const values: string[] = [];
  const injectedEnv: Record<string, string> = {};
  const blocked: string[] = [];
  for (const name of names) {
    const value = await getSecretValue(root, name, { keychain: opts.keychain });
    if (value === null) {
      // Fail-closed: never run a command that asked for a secret we do not have.
      await appendAudit(root, "agent", "command.run.blocked", { command, missing: name });
      throw new Error(`requested secret not vaulted: ${name}`);
    }
    values.push(value);
    if (isDangerousEnvName(name)) { blocked.push(name); continue; }
    injectedEnv[name] = value;
  }
  const env = { ...(process.env as Record<string, string>), ...(opts.baseEnv ?? {}), ...injectedEnv };
  const res = await runner.run(command, {
    cwd: opts.cwd ?? root, env,
    timeoutMs: opts.timeoutMs ?? 30000,
    maxBytes: opts.maxBytes ?? 256 * 1024,
  });
  const combined = res.stderr ? `${res.stdout}\n${res.stderr}` : res.stdout;
  const output = redactSecrets(combined, values);
  await appendAudit(root, "agent", "command.run", {
    command, names: Object.keys(injectedEnv), blocked,
    exitCode: res.exitCode, timedOut: res.timedOut, truncated: res.truncated,
  });
  return { output, exitCode: res.exitCode, timedOut: res.timedOut, truncated: res.truncated };
}
```
(The thrown error message carries the secret NAME only -- never a value. `values` includes even blocked ones so the redactor still scrubs a blocked secret if the command somehow echoed it.)

- [ ] **Step 3:** export `runCommand` + `RunCommandResult` + `RunCommandOptions` + `CommandRunner` from index.ts.
- [ ] **Step 4: GREEN** -- `npm test` (the redaction guard MUST pass), typecheck, lint, build. Commit -- `feat(command): runCommand (broker-injected env, redacted output, audited)`

---

### Task 3: run_command MCP tool + getBaseEnv wiring

**Files:** Modify `packages/app/src/main/mcp/tools.ts`, `mcp/tools.test.ts`, `mcp/server.ts`, `packages/app/src/main/index.ts`.

- [ ] **Step 1: thread getBaseEnv.** `mcp/server.ts` McpDeps += `getBaseEnv: () => Record<string, string>`; `createMcpServer`/`registerTools` forward it. `mcp/tools.ts` ToolDeps += `getBaseEnv`. `index.ts` startMcpServer call passes `getBaseEnv: () => loginEnv` (loginEnv is already captured at startup and passed to registerIpc as the base env).
- [ ] **Step 2: register run_command** in tools.ts (import `runCommand` from `@airlock/agent-core` -- NOT getSecretValue). Add `"run_command"` to `TOOL_NAMES` (now 10):
```ts
mcp.registerTool(
  "run_command",
  {
    description:
      "Run a shell command with the named vaulted secrets injected into its environment; output is returned with secret values redacted. Use this to run commands that need a secret (DB, API keys) without seeing the secret.",
    inputSchema: {
      command: z.string(),
      injectSecrets: z.array(z.string()).optional(),
      cwd: z.string().optional(),
    },
  },
  async ({ command, injectSecrets, cwd }) => {
    const root = deps.getWorkspaceRoot();
    if (!root) return err(NO_WORKSPACE);
    try {
      return ok(await runCommand(root, command, { injectSecrets, cwd, baseEnv: deps.getBaseEnv() }));
    } catch (e) {
      // The error message carries only a secret NAME (fail-closed), never a value.
      return err(e instanceof Error ? e.message : String(e));
    }
  },
);
```
- [ ] **Step 3: tools.test.ts** -- `toHaveLength(9)` -> `10`; confirm `run_command` is in the registered set; the FORBIDDEN source-guard test must STILL PASS (tools.ts references `runCommand`, none of the forbidden substrings). Add a focused test: run_command with no workspace -> err(NO_WORKSPACE); with a root + a stubbed runCommand (inject via deps if practical, else assert it is registered with the right input schema). Keep the allowlist + source-guard intact.
- [ ] **Step 4: GREEN** -- typecheck, test, lint, build (main CJS, no cjs_lexer; SDK still externalized). Commit -- `feat(mcp): run_command tool (broker-injected, redacted) + getBaseEnv wiring`

---

### Task 4: Docs + verify + repackage + gate

**Files:** Modify the run_command spec status, the v1 design spec (dated note), `packages/app/resources/mcp-docs/tools.md` + `security-model.md` (+ a `commands.md` resource), `README.md`.

- [ ] **Step 1: MCP resource docs** -- update `tools.md` (add run_command: when + how to use it, that values are redacted) and `security-model.md` (run_command USES secrets via the broker and redacts output; the agent never sees values; runs are audited). Optionally add `commands.md`. Flip the run_command spec Status to "v1 complete."
- [ ] **Step 2: v1 design spec** -- dated note (2026-06-05, run_command: broker-injected named secrets, output redacted by the new redact/ module, audited `command.run`, fail-closed on a missing secret; the agent uses secrets without seeing them; classifier deferred). README: a "run_command" blurb under the agent section.
- [ ] **Step 3: Full verify** -- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run package` (--dir, do NOT launch -- owner's app holds the lock). Confirm `.app` mtime advances.
- [ ] **Step 4: Commit (NO tag)** -- `docs: run_command (v1) complete; repackaged`
- [ ] **Step 5:** HUMAN GATE -- owner relaunches, reconnects, and asks the terminal Claude to run something needing a secret (e.g. "using run_command, count the rows in the loans table") -> it injects DATABASE_URL, returns the count, and the connection string never appears; the audit shows a `command.run` with the name only.

---

## Self-review notes
- Spec coverage: redactor (T1), runCommand orchestration incl. inject/filter/audit/fail-closed (T2), the MCP tool + getBaseEnv (T3), docs+gate (T4). Covered.
- Security: values injected main-side, redacted out of output, never returned; tools.ts stays clean of the forbidden fns (source-guard); the redaction guard test (command echoes secret -> ***) is the key proof; fail-closed on missing secret (name only); dangerous injected names filtered; runs audited (names not values).
- Reuse: getSecretValue, filterDangerousEnv/isDangerousEnvName, appendAudit, redactConnStrings (in the pattern pack), the DI-runner test idiom, the SDK registerTool pattern.
- The real spawn is the untested adapter (DI seam = CommandRunner); runCommand's logic is unit-tested with a fake runner + fake keychain.
