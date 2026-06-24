# AirLock threat model

AirLock makes one core promise: **the AI agent can build, run, and deploy your
app without being *able* to read your credentials.** This document states what
that does and does not mean, so you can rely on the right things — and so the
"can't leak your secrets" claim is auditable rather than marketing.

## Actors

- **You** — the human at the keyboard. Trusted.
- **The agent** — `claude` running in an AirLock terminal. Treated as *capable
  but not trusted with secret values*: it has a real shell and can run commands,
  but no tool exists that returns a vaulted secret's value.
- **The broker** — AirLock's main (Electron) process. It alone holds Keychain
  access; it injects secrets, redacts output, enforces the MCP tool allowlist,
  and writes the audit log. The renderer and the agent never get raw values.

## What AirLock protects against

1. **The agent reading a secret value.** Secrets live in the macOS Keychain. No
   MCP tool returns a value, and a build-time test fails the build if any tool
   *could*. The sidebar can reveal a value to **you**, never to the agent.
2. **Secrets leaking through agent-visible output.** Known vaulted values are
   redacted from terminal tails and from injected-command output before the
   agent sees them.
3. **Secrets sitting on disk.** Values are injected into a process environment
   at spawn/command time, not written to a `.env`. `Import .env` deletes the
   file only after every entry has vaulted.
4. **Secrets in commits.** The commit path scans staged content and blocks a
   commit that contains a vaulted secret value.
5. **Environment-based code injection.** Loader-hijack variables (`PATH`,
   `DYLD_*`, `NODE_OPTIONS`, and friends) are stripped from injected
   environments and audited, so an injected secret can't smuggle in a payload.
6. **A widened attack surface.** There is no third-party extension system, and
   the MCP server is loopback-only and bearer-token-guarded.
7. **Silent tampering.** Every broker operation is appended to a hash-chained
   audit log (`.airlock/audit/log.jsonl`); a break in the chain is detectable.

## What AirLock does NOT protect against

These are deliberate boundaries. Knowing them is part of using the tool safely:

- **Misuse of a secret the agent is allowed to *use*.** The agent has a real
  shell. If it can run a command that *uses* `DATABASE_URL`, it can also run one
  that *acts* with that access — e.g. send query results to an external host.
  AirLock stops the agent from **reading the credential**; it does not sandbox
  what a credential-bearing command does. Mitigate with least-privilege, scoped
  credentials and by reviewing what you let the agent run.
- **Output redaction is value-based.** AirLock redacts known secret *values*. A
  command that transforms or encodes a secret before printing it (e.g. base64)
  can defeat value-matching. Redaction cuts accidental leakage; it is not an
  information-flow guarantee.
- **A compromised macOS account.** AirLock trusts the OS Keychain and your login
  session. Malware running as you, or physical access to an unlocked Mac, is out
  of scope.
- **Other local processes.** The MCP server is loopback + bearer-guarded, but
  any local process that obtains the token could talk to it.
- **Supply chain.** AirLock vets its own tool surface — not the security of
  every npm dependency, nor of Claude Code itself.

## Reporting

Found a way to cross one of the lines under "protects against"? That's a
vulnerability — please report it privately (see [SECURITY.md](../SECURITY.md)).
