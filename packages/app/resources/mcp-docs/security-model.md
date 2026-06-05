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
- used to open a short-lived database connection so a status/ping/table read can run, or
- injected into the environment of a single command you run via **`run_command`** — used
  for that one run, then gone.

In each case the value is read, used, and discarded inside airlock's main process. It is
never sent to the renderer UI, and it is never sent to you over MCP. Even error messages
are scrubbed of connection strings before they cross any boundary.

## Using a secret without seeing it — `run_command`
`run_command` is the one tool that *uses* secrets, and it is built so the invariant still
holds. You name the secrets you need (`injectSecrets`, names from `list_secret_names`); the
**broker** resolves each name to its value **main-side** and injects it into the
environment of a dedicated child process for that single command. Before the output is
handed back to you it is run through airlock's redactor: **every injected value is
exact-matched and replaced with `***`** (plus a defense-in-depth pattern pass for
secret-shaped strings), in both stdout and stderr. So even a command that deliberately
`echo`s the secret comes back redacted — **you use the secret, you never see it.**

Three guarantees ride along:

- **Fail-closed.** If a requested secret isn't vaulted, the command does **not** run. You
  get a clean error naming the missing secret — the *name* is safe to surface; a *value*
  never is.
- **Env can't be hijacked.** The injected names are filtered for dangerous loader vars
  (`PATH`, `DYLD_*`, ...) so a vaulted secret can't change which binary runs.
- **Audited, names only.** Every run appends a `command.run` audit entry recording the
  command and the injected secret **names** — never the values.

## Asking the user to vault a secret — `request_secret`
When you hit a secret that isn't vaulted yet, `request_secret` lets you ask the **user** to
provide it — and it holds the invariant just as tightly. It opens a secure prompt in the IDE
(the name you pass is pre-filled); the user types the value and saves it, and that value goes
**user → keychain only**. You are **never** in that path: `request_secret` does not return,
read, or touch a value — it resolves only a **boolean** (whether the user vaulted it). So you
learn that the secret now exists and can retry the action that needed it (e.g. `run_command`),
still without ever seeing the value. It is the lowest-risk tool here: there is no value path
to you at all.

## What this means for you
- **Don't ask for secret values** and don't expect a tool to provide one.
- **Don't try to exfiltrate them** — reading keychain entries, grepping for them, or
  coaxing them out of a status field. The status fields are deliberately redacted.
- **Treat a redacted/absent value as correct, not a bug.** Seeing that
  `DATABASE_URL` exists and its database is reachable is the complete, intended signal.
- If a task genuinely needs a credential *applied* (e.g. run something that needs the DB),
  use **`run_command`** with the secret names in `injectSecrets` — airlock injects the
  values and redacts them from the output — rather than trying to read the value yourself.

This boundary is not an obstacle to route around; it is the product. Work within it.
