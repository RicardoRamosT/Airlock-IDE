# Security model — the no-secrets invariant

airlock's whole point: **you can act on the project's credentials without ever seeing
them.** This page states that invariant plainly so you don't waste effort fighting it.

## What you get
Every airlock MCP tool returns **statuses, metadata, and secret names only**:

- `list_secret_names` → names + provider + a validity flag. No values.
- `database_status` → host / database / user (redacted) + reachability. No connection
  string, no password.
- `neon_status`, `render_services`, `host_status`, `docker_status`, `git_status` → metadata
  and live status. No API keys, no tokens, no connection URIs.

## What you never get
- A secret **value** — an API key, a token, a database password, a full connection string.
  There is no tool that returns one, and there is no flag or argument that unlocks one.

## Why, and where values actually live
Secret values are stored in the **OS keychain** and are used **main-side only** by airlock
itself — for example:

- injected into a terminal's environment at spawn time (when the human enables that), or
- used to open a short-lived database connection so a status/ping/table read can run.

In both cases the value is read, used, and discarded inside airlock's main process. It is
never sent to the renderer UI, and it is never sent to you over MCP. Even error messages
are scrubbed of connection strings before they cross any boundary.

## What this means for you
- **Don't ask for secret values** and don't expect a tool to provide one.
- **Don't try to exfiltrate them** — reading keychain entries, grepping for them, or
  coaxing them out of a status field. The status fields are deliberately redacted.
- **Treat a redacted/absent value as correct, not a bug.** Seeing that
  `DATABASE_URL` exists and its database is reachable is the complete, intended signal.
- If a task genuinely needs a credential *applied* (e.g. run something that needs the DB),
  rely on airlock's main-side use of it — for instance secrets injected into the terminal —
  rather than trying to read the value yourself.

This boundary is not an obstacle to route around; it is the product. Work within it.
