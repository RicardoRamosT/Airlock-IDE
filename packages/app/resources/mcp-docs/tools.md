# MCP tools

airlock exposes 22 tools over this MCP server. Nine are **read-only status** tools; two
curate the UI (`set_sidebar_section_visibility` drives the sidebar, `dismiss_activity` hides
an Activity entry); one (`run_command`) runs a shell command with named vaulted secrets
injected and the output returned with those values **redacted**; one (`git_commit`) commits
the staged changes after a secret-leak scan of the staged content; one (`request_secret`)
asks the user to vault a secret you need (you get back only whether it was vaulted, never
the value); one (`get_terminal_tail`) reads a terminal tab's recent output, with every
vaulted secret value **redacted**; and seven **IDE-control** tools (`list_tabs`, `open_tab`,
`close_tab`, `switch_tab`, `split_view`, `open_terminal`, `close_terminal`) drive the focused
window's tabs / split / terminals, returning layout metadata only. **None returns a secret
value.**

Workspace-rooted tools error with "No workspace open" if the human has not opened a folder
yet; the app-global tools (and the IDE-control tools) work regardless.

## Sidebar control

- **`list_sidebar_sections`** — list every sidebar section (`files`, `secrets`, `git`,
  `databases`, `docker`, `host`, `audit`, `activity`) with its label and current visibility.
  Call this first when you want to curate the sidebar, so you know the current state.
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
- **`activity_status`** — the focused project's Activity feed: in-progress CI runs, Render
  deploys, and transitional Docker containers, each with its state and a **stable entry id**.
  This is the same list the Activity panel shows (`sidebar-activity.md`) — status metadata
  only (titles, states, branches, urls), never a secret value. App-global: CI is skipped when
  no folder is open; Render/Docker still report. Use it to watch live build/deploy/container
  progress, and to get the entry ids you pass to `dismiss_activity`.

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
  value main-side, you never see it**, and if the command echoes it — literally, or in a
  common single-shot encoding (base64/base64url/hex/base32/percent-encoding) — the output comes
  back redacted (`***`). (Not a wall against a determined process: an arbitrary transform
  it applies once it holds the value — reverse, split, gzip, char-by-char, or nested/
  double-encode (the encoding passes are single-layer, decoding a run once, not recursively)
  — can still slip; the structural guarantee is that no tool returns a raw
  value.) **Fail-closed:** if a requested name isn't vaulted, the command does **not** run
  and you get a clean error naming the missing secret (the name is safe; a value never is).
  **Every run is audited** (`command.run` — the command and the secret *names*, never the
  values). Workspace-rooted (needs an open folder). See `security-model.md`.

## Acting — commit the staged changes

- **`git_commit`** — commit what is currently staged in the open folder. Args: `message`
  (the commit message) and an optional `confirm`. Before committing, airlock **scans the
  staged content for suspected secret values/patterns**: if any are found the commit is
  **BLOCKED** and you get back the leak locations (secret name/type + `path:line`, **never
  the value**) — tell the user what was found, and only re-call with `confirm: true` if
  they decide to commit anyway. The commit is authored as the project's configured GitHub
  account. Stage files first via `run_command` (`git add …`) if needed; use `git_status` to
  see what is staged. Workspace-rooted (needs an open folder). See `security-model.md`.

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

## Observing — read a terminal tab's recent output

- **`get_terminal_tail`** — read the recent output of a terminal tab. Two modes:
  - **No `terminalId` → LIST the terminals.** Returns one entry per live terminal:
    `{ id, preview }`, where the preview is a short **redacted** snippet (the last few
    non-empty lines of that terminal's output). Use it to tell tabs apart — the one
    streaming dev-server logs vs. an idle shell — and pick the `id` you want.
  - **With a `terminalId` → that terminal's redacted tail.** Returns the last `lines`
    of its cleaned, **redacted** output (default `40`). Use it to see what the user is
    running in another tab: a dev server's errors, a build/test run, log output.
  - **Secret values are redacted.** Every vaulted secret value is matched and replaced
    with `***` before the text reaches you — its literal form *and* its common single-shot
    encodings (base64/base64url/hex/base32/percent-encoding) — same redactor as `run_command`.
  - **Honest limits — read before you rely on it:**
    - **Great for logs / errors / build output;** APPROXIMATE for full-screen TUIs
      (vim, htop, cursor-addressed UIs). airlock strips ANSI escapes and collapses
      carriage-return overwrites — it is **not** a full terminal emulator, so a
      redrawing TUI reads only roughly.
    - **Redaction is defense-in-depth, not a wall** (same as `run_command`). It catches
      a secret's literal value and its common single-shot encodings (base64/base64url/
      hex/base32/percent-encoding), but **not** an arbitrary transform applied before it hit
      the terminal — reversed, split across lines, gzipped, printed char-by-char, encrypted,
      or nested/double-encoded (e.g. base64 of base64; the encoding passes are single-layer,
      not recursive). Treat the tail as helper context, not a hardened
      channel; the structural guarantee is that no tool returns a raw value.
    - **Your OWN terminal appears in the list.** airlock can't distinguish the PTY
      you're running in from the user's other tabs, so your own terminal shows up —
      reading it is just redundant, not harmful.
    - **Only the last-focused window's terminals.** When airlock has multiple windows
      open, this lists/tails the terminals of the **last-focused window** only — the
      same window the rest of your tools resolve to (see `overview.md`). Terminals in
      other windows are not visible here, and each window's tail is redacted against
      that window's own vaulted secrets.

## Curating the Activity feed

- **`dismiss_activity`** — hide one Activity entry by its **id** (the `id` field from
  `activity_status`, e.g. `ci:<sha>`, `render:<id>`, `docker:<id>`). Arg: `entryId`. It
  removes that entry from the Activity panel for everyone (the dismissed set is app-global,
  in-memory) and the UI updates live. Use it to clear a finished or no-longer-interesting
  row — a passed CI run, a completed deploy — so the panel shows only what still matters.
  Dismissal is **not sticky to new work**: a later run/deploy/container gets a **new id** and
  reappears, and the set is **not persisted** across an app restart. Call `activity_status`
  first to get the id; the id is opaque and carries no secret value.

## Driving the IDE - tabs, split, terminals (focused window)

Seven tools let you arrange the **layout** of the focused window. They carry only tab ids,
terminal ids, and a folder path in, and return **layout metadata** out (each tab's id, name,
root, focused/in-split flags, and its terminals as `{ id, title }`, plus the split pair) -
**never a secret value**. Full reference + the layout shape: `ide-control.md`.

- **`list_tabs`** - the focused window's layout (tabs + their terminals + the split pair).
  No args. Call it first to learn the tab/terminal ids you pass to the others.
- **`open_tab`** - open a project folder as a NEW tab (arg: `path`) or a blank tab (no arg)
  in the focused window. Opening a path sets the window root, recents, and the MCP
  registration, exactly like the human opening it.
- **`close_tab`** - close a tab by `tabId`. Closing the last tab leaves a fresh blank tab.
- **`switch_tab`** - focus a tab by `tabId` (your "current project" follows the focused tab).
- **`split_view`** - toggle the split: with a `tabId`, split the focused tab beside it; with
  no `tabId`, split beside a new blank tab (or collapse the split if already showing).
- **`open_terminal`** - open a new terminal (arg: optional `tabId`, else the focused tab; the
  tab is focused first). The reply's tab `terminals` include the new one. The shell gets the
  project's secrets injected - you see no values.
- **`close_terminal`** - close a terminal by `terminalId`.

These change LAYOUT only. To run something that needs a credential use `run_command`; to read
a terminal's output use `get_terminal_tail` (both redact). See `security-model.md`.

## Picking a tool

- Curating the sidebar → `list_sidebar_sections`, then `set_sidebar_section_visibility`.
- "Is X set up / reachable?" → the matching status read (`database_status`, `host_status`,
  `docker_status`, `render_services`, `neon_status`).
- "What is building / deploying right now?" → `activity_status` (the live CI/deploy/container
  feed with entry ids); to clear a finished row from the panel, `dismiss_activity` with its id.
- "What does this project use?" → `list_secret_names` + the status reads together paint the
  picture (e.g. a `postgres-url` secret + a reachable DB ⇒ surface Databases).
- "Run something that needs a credential" → `run_command` with the secret **names** in
  `injectSecrets` (from `list_secret_names`). airlock injects the values, you get redacted
  output.
- "Commit the staged changes" → `git_commit` with a message (`git_status` first to see what
  is staged). A suspected secret in the staged content blocks the commit and reports the
  leak locations — surface them to the user before even considering `confirm: true`.
- "The secret I need isn't vaulted yet" → `request_secret` with the name (a secure prompt
  opens for the user to vault it); when it reports vaulted, retry the action that needed it.
- "What is the user running in another tab / what does that error say?" → `get_terminal_tail`
  with no `terminalId` to list the tabs (by redacted preview), then with the chosen `id` to
  read its redacted tail.
- "Open / arrange the IDE for me" → the IDE-control tools (`list_tabs` first, then
  `open_tab` / `switch_tab` / `split_view` / `open_terminal` / `close_tab` / `close_terminal`).
  They drive the focused window's layout and return metadata only (see `ide-control.md`).
- You will **never** find a tool that hands you a secret value — that is by design.
  `run_command` *uses* a secret on your behalf but redacts it out of what you get back.
