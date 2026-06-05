# airlock MCP IDE-Bridge Design

**Date:** 2026-06-04
**Status:** Design approved. Building v1 (IDE-aware + sidebar control).

## Overview
Instead of embedding its own agent + chat panel, airlock exposes itself as a **local MCP server**. The Claude Code the user already runs in airlock's integrated terminal connects to it and gains:
- **Resources** - markdown docs describing the IDE (the ".md manual") so the terminal Claude "knows everything about the IDE".
- **Read tools** - every live status (DB / Docker / Neon / Render / git / local-host / sidebar sections / secret NAMES).
- **UI-control tools** - show/hide sidebar sections (the "curate my sidebar for this project" example).

No embedded Agent SDK loop, no chat UI, no second API key. The terminal Claude IS the agent; airlock is the tool/resource provider.

## Why this fits airlock (security)
The MCP server is the SECOND external boundary (after the renderer IPC) that the core invariant covers: **the agent can never read a secret value.** Concretely:
- The MCP tool registry exposes statuses + UI control + secret NAMES only. `getSecretValue` / `getGlobalSecret` are NEVER registered as MCP tools (same hard rule as for renderer IPC and agent tools).
- The server binds `127.0.0.1` only and requires a **bearer token** that airlock generates and injects into the Claude Code MCP config - so only the user's Claude (not an arbitrary local process) can call airlock's tools.
- Claude Code gates airlock twice for the user: approve-the-server once, then approve-the-first-mutating-tool-call.
- Honest caveat (orthogonal to MCP): if the user toggles inject-secrets-into-terminal ON, the secret values are in that shell's env and the Claude running there can read them via `env` - nothing to do with the MCP boundary, and why injection defaults OFF.

## Architecture
- **Transport: HTTP** (Claude Code's recommended transport for a long-running local app; stdio would respawn per session). airlock's main process hosts `http://127.0.0.1:<port>/mcp`, started when the app is ready, stopped on quit. If the server is down, Claude Code reconnects when it returns.
- **Port:** a stable default port; if taken, pick a free one. The chosen port (+ token) is written into the Claude Code config so the URL always matches.
- **SDK:** the official `@modelcontextprotocol/sdk` (McpServer + a streamable-HTTP transport), added to `packages/app` (the server runs main-side).
- **The server is a thin layer** over functions airlock already has. UI control reuses `changeSectionVisibility` (persist + View-menu rebuild + live renderer push). Statuses reuse the same agent-core/main reads the renderer IPC uses - extracted into shared `ide-state` functions so IPC and MCP share one source of truth (no drift).

## Registration (local scope - approved)
On opening a project, airlock registers its MCP server in Claude Code's **local scope** (stored in `~/.claude.json`, keyed to the project path) - so it does NOT write any file into the user's repo (no git noise). Mechanism: shell out `claude mcp add --transport http airlock http://127.0.0.1:<port>/mcp --scope local --header "Authorization: Bearer <token>"` (airlock already adopts the login PATH, so `claude` resolves). If `claude` is not found, surface a clear one-time hint with the exact command. Re-register if the port/token changes.

## Resources (the ".md manual")
Markdown docs shipped as MCP resources (`@airlock:...`), one per topic so the terminal Claude can pull in exactly what it needs:
- `overview` - what airlock is, the panes, the security model in one paragraph.
- `sidebar/<section>` - one per section (Files, Secrets, Git, Databases, Docker, Host, Audit): what it shows, and when it is useful for a project (so Claude can curate).
- `tools` - the available MCP tools + when to use them.
- `security-model` - the no-secrets invariant, so Claude knows it cannot and should not reach for values.
These live under a docs dir bundled with the app and are served via `resources/list` + `resources/read`.

## Tools (v1 - all read-only or UI-only; NO secret values)
| Tool | Kind | Wraps |
|---|---|---|
| `list_sidebar_sections` | read | loadPrefs().sectionVisibility + SECTIONS |
| `set_sidebar_section_visibility(section, visible)` | UI mutate | `changeSectionVisibility` (persist + menu + live push) |
| `database_status` | read | vaulted postgres-url conns + SELECT 1 reachability (host/name, no value) |
| `docker_status` | read | docker containers |
| `neon_status` | read | Neon connected? + projects/branches/databases (metadata) |
| `render_services` | read | Render services filtered to the project repo + deploy status + deployed? |
| `git_status` | read | branch + porcelain status |
| `host_status` | read | local dev-server URL + up/down |
| `list_secret_names` | read | `listSecrets` -> names + provider + valid (NEVER values) |

Tool conventions (per Claude Code guidance): imperative names, one-line descriptions noting side effects, mutating tools return the new state, set-style (idempotent) not toggle-style.

## Build slices
- **v1 (this spec):** the MCP server + transport + local-scope registration + the resource docs + the read/UI tools above. Establishes the runtime + the no-secrets tool boundary on the safest surface.
- **Later slices (out of scope here):** `run_command` (dedicated PTY, streaming redactor, command policy, broker secret injection), `request_secret` (opens the secure modal), file editing, `get_terminal_tail`. These add the heavier/riskier agent powers from the v1 design spec sec.6 once the bridge is proven.

## Out of scope (v1)
- The embedded Agent SDK loop / a chat panel (explicitly NOT building - the terminal Claude is the agent).
- Any tool that executes commands or returns a secret value.
- Multi-window / multi-project MCP routing (assume one open project per airlock window).
