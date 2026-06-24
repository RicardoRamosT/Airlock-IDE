# Contributing

Thanks for your interest in AirLock.

**A note on the license first.** AirLock is **source-available, not open
source** ([PolyForm Strict 1.0.0](LICENSE.md)). The license does not grant the
right to modify or redistribute the source, so **outside code contributions
(pull requests) can't be accepted** — merging them would require rights the
license doesn't give. This is intentional: AirLock is a security-sensitive tool
kept as one canonical, audited build.

**What is very welcome:**

- **Bug reports** — especially anything touching the security invariants (a
  secret value reaching the agent, redaction gaps, MCP allowlist escapes). For
  those, please use private reporting — see [SECURITY.md](SECURITY.md).
- **Feature ideas and feedback** — open a
  [suggestion](https://github.com/RicardoRamosT/Airlock-IDE/issues/new/choose).
- **Reproductions** — a clear set of steps or a short screen recording makes any
  issue far easier to fix.

The source is public so you can **read and verify** it — the security claims are
only meaningful if you can audit them — and use AirLock for noncommercial
purposes. For commercial or other licensing, contact the author
([@RicardoRamosT](https://github.com/RicardoRamosT)).
