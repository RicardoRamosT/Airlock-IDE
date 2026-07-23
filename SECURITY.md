# Security Policy

AirLock's entire purpose is to keep your credentials away from the AI agent, so
security reports are triaged ahead of everything else.

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/RicardoRamosT/Airlock-IDE/security/advisories/new)
(repo **Security ▸ Report a vulnerability**). If that's unavailable, contact the
author through [@RicardoRamosT](https://github.com/RicardoRamosT) and ask for a
private channel before sharing details.

Please include:

- What you found and the impact.
- Steps to reproduce (a proof-of-concept helps a lot).
- The AirLock version (the release tag, or **Settings ▸ About**).

I aim to acknowledge reports within a few days and to fix confirmed, in-scope
issues in a timely release, crediting you unless you'd rather stay anonymous.

## What's in scope

Anything that breaks AirLock's core promise — see the
[threat model](docs/threat-model.md) for the precise guarantees:

- The agent reading a vaulted secret **value** it shouldn't.
- Output redaction being bypassed so a secret value reaches the agent.
- Escaping or widening the MCP tool allowlist.
- Forging or silently breaking the hash-chained audit log.
- A vaulted secret leaking to disk or into a commit.

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
