# MCP tools

airlock exposes 11 tools over this MCP server. Eight are **read-only status** tools; one
(`set_sidebar_section_visibility`) drives the sidebar UI; one (`run_command`) runs a shell
command with named vaulted secrets injected and the output returned with those values
**redacted**; one (`request_secret`) asks the user to vault a secret you need (you get back
only whether it was vaulted, never the value). **None returns a secret value.**

Workspace-rooted tools error with "No workspace open" if the human has not opened a folder
yet; the app-global tools work regardless.

## Sidebar control

- **`list_sidebar_sections`** — list every sidebar section (`files`, `secrets`, `git`,
  `databases`, `docker`, `host`, `audit`) with its label and current visibility. Call this
  first when you want to curate the sidebar, so you know the current state.
- **`set_sidebar_section_visibility`** — show or hide one section (args: `section`,
  `visible`); returns the new visibility map. Use it to tailor the sidebar to the project:
  reveal the sections that matter (see the `sidebar-*.md` files for the per-section "when
  it's useful" rules) and hide the ones that don't. App-global, no workspace needed.

## Status reads — app-global (no open folder required)

- **`docker_status`** — Docker engine state (installed/running) and the container list.
  Use it to check containers, or to decide whether the Docker section is relevant.
- **`neon_status`** — whether a Neon account is connected, and the Neon projects when it is.
  Use it before reasoning about Neon databases.
- **`render_services`** — the Render services with deploy state (filtered to this repo when
  a folder is open and its origin matches). Use it to check deploy status vs local HEAD.

## Status reads — workspace-rooted (need an open folder)

- **`database_status`** — the project's vaulted Postgres databases with redacted info
  (host/database/user) and a reachability flag. Use it to see what DBs the project has and
  whether they're up — never to get a connection string.
- **`git_status`** — the working-tree git status (branch, staged/unstaged changes) for the
  open folder. Use it to understand the repo state before suggesting commits/branches.
- **`host_status`** — the resolved local dev-server URL and whether it's reachable. Use it
  to check if the dev server is running.
- **`list_secret_names`** — the project's secret **names** with provider and validity — no
  values, ever. Use it to learn what credentials exist (and thus what the project needs),
  e.g. to decide which sidebar sections to surface. See `security-model.md`.

## Acting — run a command that needs a secret

- **`run_command`** — run a shell command with named vaulted secrets injected into its
  environment for just that one run; the output is returned with every injected value
  **redacted** (`***`). Args: `command` (the shell command), `injectSecrets` (an array of
  secret **names** — exactly as returned by `list_secret_names`, never values — to inject),
  and an optional `cwd` (defaults to the workspace root). Use it for commands that need a
  credential to work: a `psql`/migration against `DATABASE_URL`, a `curl` that needs an API
  key, a script that reads a token from its env. You name the secret; **airlock injects the
  value main-side, you never see it**, and if the command echoes it the output comes back
  redacted. **Fail-closed:** if a requested name isn't vaulted, the command does **not** run
  and you get a clean error naming the missing secret (the name is safe; a value never is).
  **Every run is audited** (`command.run` — the command and the secret *names*, never the
  values). Workspace-rooted (needs an open folder). See `security-model.md`.

## Acting — ask the user to vault a secret you need

- **`request_secret`** — ask the user to vault a secret you need. A secure prompt opens in
  the IDE (the name pre-filled); the user types and saves the value, which goes straight to
  the keychain. You get back only **whether it was vaulted** — never the value. Args: `name`
  (the secret name to request, e.g. `DATABASE_URL`) and an optional `providerHint` (a short
  note about what kind of value it is, e.g. "looks like a Postgres URL"). **When to use it:**
  after a tool reports a secret is **not vaulted** (e.g. `run_command` fails closed naming a
  missing secret), call `request_secret` with that name, then **retry** the original action
  once it reports vaulted. Workspace-rooted (the secret is vaulted into the open project).
  See `security-model.md`.

## Picking a tool

- Curating the sidebar → `list_sidebar_sections`, then `set_sidebar_section_visibility`.
- "Is X set up / reachable?" → the matching status read (`database_status`, `host_status`,
  `docker_status`, `render_services`, `neon_status`).
- "What does this project use?" → `list_secret_names` + the status reads together paint the
  picture (e.g. a `postgres-url` secret + a reachable DB ⇒ surface Databases).
- "Run something that needs a credential" → `run_command` with the secret **names** in
  `injectSecrets` (from `list_secret_names`). airlock injects the values, you get redacted
  output.
- "The secret I need isn't vaulted yet" → `request_secret` with the name (a secure prompt
  opens for the user to vault it); when it reports vaulted, retry the action that needed it.
- You will **never** find a tool that hands you a secret value — that is by design.
  `run_command` *uses* a secret on your behalf but redacts it out of what you get back.
