# Security Policy

AirLock's entire purpose is to keep your credentials away from the AI agent, so
security reports are triaged ahead of everything else.

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/RicardoRamosT/Airlock-IDE/security/advisories/new)
(repo **Security ▸ Report a vulnerability**) — it is private, structured, and the
route that gets read first. If that's unavailable to you, email
<ricardoramostrevino@hotmail.com> directly. Don't ask for a private channel and
wait for a reply; if you have something urgent, the address above IS the channel.

Please include:

- What you found and the impact.
- Steps to reproduce (a proof-of-concept helps a lot).
- The AirLock version (the release tag, or **Settings ▸ About**).

I aim to acknowledge reports within a few days and to fix confirmed, in-scope
issues in a timely release, crediting you unless you'd rather stay anonymous.

## Five things AirLock claims are impossible — break one

This is an invitation, not just a policy. AirLock's central claim is unusually
falsifiable, so here it is as five things that should not be achievable. **Land
any of them and you get credit** — by name, or anonymously if you prefer.

1. Get the agent to read a vaulted secret **value** it shouldn't have.
2. Bypass output redaction so a secret value reaches the agent's context.
3. Escape or widen the MCP tool allowlist.
4. Forge or silently break the hash-chained audit log.
5. Get a vaulted secret onto disk, or into a commit.

Attempts and their outcomes get written up publicly — **including the ones that
fail**. A record of serious attempts that did not work is the only third-party
evidence a project this size can honestly produce, and it is worth more than
anything I can assert about my own code.

The [threat model](docs/threat-model.md) states the precise guarantees, and
[this test](packages/app/src/main/mcp/tools.test.ts) is the build-enforced
version of #1 and #2: it reads the MCP tool file and fails if it so much as
references a value-returning function.

Start with `docs/threat-model.md#what-airlock-does-not-protect-against` before
you begin — several obvious attacks are already documented as **out of scope**,
and knowing which saves you the time.

## What's out of scope

- Anything requiring an already-compromised macOS account or physical access to
  an unlocked machine.
- Misuse of a secret the agent is *allowed to use* — the agent has a real shell
  by design; AirLock stops it from **reading** credentials, not from acting with
  ones it's permitted to use. (See the threat model.)
- Third-party dependency CVEs without a demonstrated AirLock impact.

## Supported versions

AirLock ships from a single canonical build; fixes land in the **latest**
release. Please reproduce against the newest release before reporting.
