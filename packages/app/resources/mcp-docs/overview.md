# airlock — overview for the agent

airlock is a **terminal-first AI IDE**. You (the terminal Claude) are running inside a
terminal that airlock spawned. airlock is the workbench around that terminal: it manages
the open project folder, the project's secrets, git, databases, Docker, the local dev
server, and an audit log — and it exposes all of that to you over this MCP server.

## The panes

airlock's window has three regions:

- **Sidebar** (left, can be moved to the right or hidden) — a stack of collapsible
  sections: Files, Secrets, Git, Databases, Docker, Host, Audit. This is the project's
  status at a glance. You can read every section's live status and you can show/hide
  sections to curate what the human sees (see `tools.md`).
- **The terminal owns the right-hand side.** By default the main area is just the
  terminal — that is where you live. It is the primary surface, not an afterthought.
- **An on-demand viewer split.** When the human opens a file, a git diff, the settings
  tab, or a database table, a viewer pane splits in beside the terminal. When nothing is
  selected, the terminal takes the whole area again.

## The one crucial fact

You can **read every status** airlock tracks (git, databases, Docker, Neon, Render, the
host dev server, secret *names*) and you can **drive the sidebar** (list sections, show or
hide them). 

But you can **never read a secret value.** That is airlock's entire reason to exist: the
human's API keys, database passwords, and tokens live in the OS keychain and are only ever
used main-side (e.g. injected into a terminal at spawn, or used to open a short-lived
database connection). No tool returns a value, and there is no path for you to obtain one.
You can see that a secret named `OPENAI_API_KEY` exists, that it is a valid-looking key,
and that a database is reachable — never the secret itself. Don't ask for values, don't
try to read them from disk, and don't treat their absence as a problem to solve. See
`security-model.md`.

## How to use this manual

- `tools.md` — the 9 MCP tools and when to reach for each.
- `security-model.md` — the no-secrets invariant in plain terms.
- `sidebar-*.md` — one file per sidebar section: what it shows and **when it is useful**
  for a given project, so you can curate the sidebar to match the project in front of you.
