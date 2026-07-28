# AirLock threat model

AirLock makes one core promise: **you never hand the agent a credential.** It can
build, run and deploy your app using secrets it was never given.

Stated precisely, because the difference matters:

- **Structural** — no `.env` on disk, and no MCP tool that can return a secret
  value (enforced by a test that fails the build). These are properties of the
  design; no amount of cleverness by the agent changes them.
- **Best-effort** — output redaction. A command the agent runs *with* a
  credential has that credential in its environment; AirLock filters the output
  rather than stopping the process from reading it. The filter covers the literal
  value and its single-shot encodings (base64/base64url/hex/base32/percent/JSON),
  so the obvious `echo | base64` is caught. An arbitrary transform by a process
  that holds the value — reverse, split, gzip, char-by-char, encrypt,
  double-encode — is not.

So the guarantee is about the interface, not about information flow. This
document exists so you can rely on the right half, and it says so in the
non-goals below rather than leaving you to find out.

## Two postures, one setting

AirLock ships in two security postures, and a single per-project setting decides
which one you are in. This is the most important thing in this document.

**Default — `injectSecretsIntoTerminal: false`.** No vaulted secret is in any
terminal's environment. The auto-started `claude` inherits nothing. The only way a
secret reaches a process is `run_command`, where the broker resolves the value
main-side into one child process and filters the output on the way back. The
guarantee above holds: the agent is never handed a credential.

**Injection mode — `injectSecretsIntoTerminal: true`.** Every vaulted value is put
into the shell's environment at spawn. `claude` is started inside that shell, so
its own process environment holds them, and every command it runs inherits them.
**Redaction does not apply on this path at all** — it filters `run_command` output
and `get_terminal_tail`, both cases where AirLock hands bytes to the agent. When
the agent *is* the process in the terminal, it reads its own environment with
nothing in between. `echo $DATABASE_URL` returns the value in plain text; no
encoding, nothing to defeat.

So injection mode is not the default guarantee with a caveat. It is a different
trade: you gain long-lived credentials for processes that need them for their
whole lifetime (a dev server), and you give up the read barrier for the agent
sharing that terminal. The toggle says so at the point of decision; this document
says it here so it is still true three weeks later.

Everything below describes the DEFAULT posture unless it says otherwise.

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
