# run_command (Agent capability) Design

**Date:** 2026-06-05
**Status:** Design approved. Building v1.

## Overview
A new MCP tool, `run_command`, that lets the terminal Claude run a shell command **with named vaulted secrets injected by the broker**, and get the output back **redacted** -- so the agent USES a secret without ever SEEING its value. This extends the MCP IDE-bridge (the agent already reads statuses + curates the sidebar; now it can run things that need secrets).

## Why this tool exists (scope)
The terminal Claude already runs plain commands via its own Bash tool. With inject-into-terminal OFF (the safe default), the vaulted secrets are NOT in that shell's env, so the agent's own Bash can't run anything that needs them. `run_command` is the bridge: airlock injects the requested secret(s) into the environment for JUST that one command, runs it, and the value never lands in the shell or in the agent's view. So this tool is NOT a generic runner (that would be redundant + add nothing); its single job is secret-bearing commands.

## The flow
1. Agent calls `run_command(command, { injectSecrets?: string[], cwd?: string })`. It knows valid secret names from `list_secret_names`.
2. MCP tool (main, root-gated) -> agent-core `runCommand(root, command, { injectSecrets, cwd })`.
3. runCommand: resolve each requested name to its value MAIN-SIDE (getSecretValue); build the child env = safe base env (real PATH etc.) + the injected name=value pairs, with `filterDangerousEnv` applied to the INJECTED set (a vaulted "PATH"/"DYLD_*" can't hijack the binary); spawn `sh -c <command>` as a child process (cwd = cwd||root) with a timeout + an output cap; capture stdout+stderr.
4. REDACT the captured output through the redactor BEFORE returning: exact-match every injected secret VALUE -> `***` (all occurrences, both streams), plus a pattern-pack pass for stray secret-shaped strings (connstrings, common key shapes).
5. AUDIT: append a `command.run` entry (the command + the injected secret NAMES + exit code/timedOut -- NEVER the values).
6. Return `{ output: <redacted>, exitCode, timedOut, truncated }`. The secret values are NEVER in the result.

## The redactor (new agent-core `redact/` module) -- the security-critical piece
`redactSecrets(text, values: string[], opts?): string`:
- Exact-match: replace every occurrence of each non-empty injected value with `***` (this is the must-have -- if a command echoes the injected secret, the agent must get `***`).
- Pattern-pack (defense-in-depth): reuse/extend `redactConnStrings` (scheme://user:pass@) + a few common shapes (e.g. `Bearer <token>`, long hex/base64 runs that look like keys) to catch secret-shaped strings NOT in the injected set.
- Pure + heavily TDD'd. Adversarial test: a command that prints an injected value (and one split oddly) must come back redacted.

## Security model (how the invariant holds for a tool that USES secrets)
- `getSecretValue` IS used deep inside `runCommand` -- intentionally; injecting the secret is the whole point. But the value is injected into the child env and **redacted out of the output**, so it never reaches the agent. This RELAXES the read-tools' "getSecretValue is never reachable from any tool" specifically for `run_command`, REPLACED by a stronger, tested guarantee: **`run_command`'s output is redacted of every injected value (+ pattern-pack) and the values are never in the result.**
- `tools.ts` still does not reference `getSecretValue` directly (the `run_command` tool calls agent-core `runCommand`); the source-guard test stays. The NEW guard is a `runCommand` test proving the returned output never contains an injected value even when the command echoes it.
- The injected env is `filterDangerousEnv`'d (an injected env var can't hijack which binary runs).
- `run_command` is requireRoot-gated (runs in the project) and audited every call.
- Safety: leans on Claude Code's built-in per-tool approval (the user approves `run_command` on first use) + always-on audit. NOTE: the terminal Claude can already run any command via its own Bash, so `run_command` adds NO command-execution risk -- its only new power is using secrets, which the redactor + env-filter + audit cover. The command-risk classifier is deferred.

## Robustness
- Timeout (default ~30s): on timeout, kill the process tree, return the partial (redacted) output + `timedOut: true`.
- Output cap (default ~256KB): truncate beyond the cap, set `truncated: true` (redaction still applied to the kept portion).
- Non-zero exit is normal: return the exit code + (redacted) output, not an error.

## Tools registry change
`run_command` becomes the 10th MCP tool. The allowlist guard test updates to exactly 10. The `set_*` / read tools are unchanged. The MCP server registers it in the same per-request `registerTools`.

## Out of scope (v1)
- The command-risk classifier (rm -rf / curl|sh flagging) -- deferred.
- A live "agent commands" panel in airlock's UI (audit-only for now).
- PTY-based interactive run_command (child-process capture for v1; no stdin/interactivity).
- Streaming output to the agent mid-run (one-shot captured result for v1).
