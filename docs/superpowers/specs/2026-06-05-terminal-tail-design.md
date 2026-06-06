# get_terminal_tail (Agent capability) Design

**Date:** 2026-06-05
**Status:** v1 complete.

## Overview
A new MCP tool, `get_terminal_tail`, that lets the terminal Claude (the agent) read
the recent OUTPUT (tail) of a terminal tab -- so it can see what the USER is
running in other tabs (a dev server's errors, a build/test run, logs) that it
cannot otherwise observe. The tail is REDACTED of every vaulted secret value
before it reaches the agent, and every read is audited. It is the agent's first
ability to OBSERVE the user's session (vs. running its own commands).

## Consent model (owner's choice)
All terminal tabs are readable, with no extra toggle. The protection is:
value-redaction (vaulted secrets -> ***) on every read + an audit entry
(`terminal.read`, ids/counts only) + Claude Code's per-tool approval on first use.
(Per-terminal/global opt-in were offered and declined in favor of redact+audit.)

## Why main needs a ring buffer (the key architectural fact)
The terminal scrollback lives RENDERER-SIDE in xterm; main streams `onData`
straight through and keeps NO buffer. So `get_terminal_tail` requires main to add
a bounded per-PTY ring buffer, teed into the existing `onData` path (the single
insertion point), capped in size, and cleaned up when the PTY exits/dies.

## Targeting + labels (main-only, content-preview)
Main only knows opaque PTY ids (randomUUID); the human-readable titles live
renderer-side. Rather than sync titles main-side, the enumerate identifies
terminals BY CONTENT: for each live PTY, main returns its id + a short REDACTED
preview (the last few non-empty lines of its buffer). The agent reads the previews
to tell tabs apart (the one showing dev-server logs vs an idle shell), then reads
the chosen id. This keeps the WHOLE feature main-side -- no renderer changes. The
tool:
- `get_terminal_tail({ lines? })` with NO terminalId -> the LIST:
  `[{ id, preview }]` (preview = redacted last ~3 non-empty lines).
- `get_terminal_tail({ terminalId, lines? })` -> that terminal's redacted tail
  (default ~40 lines, capped ~400).

## The flow (read path)
1. Agent calls `get_terminal_tail({ terminalId, lines })`.
2. MCP tool (main, root-gated) -> a main-side `getTerminalTail(termId, lines)` dep
   that: reads the ring buffer for `termId`; CLEANS it (strip ANSI escape
   sequences + collapse carriage-return overwrites) via a pure agent-core helper;
   slices the last N lines; gathers ALL vaulted secret VALUES (listSecrets ->
   getSecretValue per name, mirroring the db:list pattern) main-side; runs
   `redactSecrets(tail, allValues)`; appends an audit entry `terminal.read
   { termId, lines }` (NEVER the content); returns the redacted text.
3. The agent never sees a secret value: the tail is value-redacted, and the tool
   calls the dep (not getSecretValue), so tools.ts stays clean.

## Security model
- The tool does NOT reference getSecretValue/getGlobalSecret etc. (the source-guard
  stays green); value resolution + redaction live behind the `getTerminalTail` dep,
  exactly like `run_command` calls `runCommand`.
- Allowlist becomes exactly 12; the guard test updates 11 -> 12.
- root-gated (terminal reads belong to the open project's session) + audited.
- Redaction covers ALL vaulted values (any could appear), not just an injected set.

## Honest limits (documented, not "fixed")
- RAW-OUTPUT APPROXIMATION: main is not a terminal emulator. ANSI is stripped and
  CR-overwrites collapsed, so logs/errors/build output read cleanly, but
  full-screen TUIs (vim, htop, cursor-addressed UIs) are approximate. (The accurate
  upgrade -- reading the renderer's xterm buffer over a round-trip -- is deferred.)
- REDACTION LIMIT: same as run_command -- redaction now catches a secret value's
  LITERAL form plus its common single-shot encodings (base64/base64url/hex/percent-
  encoding). Arbitrary transforms remain the limit: a value reversed, split across
  lines, base32'd, gzipped, printed char-by-char, encrypted, or double-encoded before
  it hit the terminal still slips. That is inherent (no output filter catches every
  disguise); the standing guarantee is structural (no tool returns a raw value; inject
  defaults OFF). The deferred command-risk classifier is a complementary future
  mitigation. For v1 the agent is the owner's helper, not an attacker. See
  `2026-06-05-encode-aware-redaction-design.md`.
- AGENT'S OWN TERMINAL: main cannot distinguish the agent's PTY from the user's
  tabs (all spawned identically; the MCP connection is not tied to a PTY), so the
  agent's own terminal appears in the list. Reading it is redundant, not harmful.
- RING BUFFER BOUND: only the last ~N KB per terminal is retained; output older
  than the cap is gone (acceptable -- this is a "tail," not full history).

## Out of scope (v1)
- Renderer-xterm-accurate reads (the round-trip upgrade for perfect TUI fidelity).
- Human-readable terminal titles / "active terminal" default (the enumerate is
  content-preview based; syncing xterm titles main-side is deferred -- the agent
  picks an id from the id+preview list).
- Streaming/following a terminal (one-shot tail per call).
- Excluding the agent's own terminal (would need tagging the agent's PTY at spawn).
- A delete/clear-buffer control.
