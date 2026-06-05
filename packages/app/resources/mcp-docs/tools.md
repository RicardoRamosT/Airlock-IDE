# MCP tools

airlock exposes 9 tools over this MCP server. Eight are **read-only status** tools; one
(`set_sidebar_section_visibility`) drives the sidebar UI. **None returns a secret value.**

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

## Picking a tool

- Curating the sidebar → `list_sidebar_sections`, then `set_sidebar_section_visibility`.
- "Is X set up / reachable?" → the matching status read (`database_status`, `host_status`,
  `docker_status`, `render_services`, `neon_status`).
- "What does this project use?" → `list_secret_names` + the status reads together paint the
  picture (e.g. a `postgres-url` secret + a reachable DB ⇒ surface Databases).
- You will **never** find a tool that returns a secret value — that is by design.
