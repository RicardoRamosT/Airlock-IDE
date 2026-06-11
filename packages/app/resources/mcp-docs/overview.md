# airlock — overview for the agent

airlock is a **terminal-first AI IDE**. You (the terminal Claude) are running inside a
terminal that airlock spawned. airlock is the workbench around that terminal: it manages
the open project folder, the project's secrets, git, databases, Docker, the local dev
server, and an audit log — and it exposes all of that to you over this MCP server.

> **Multiple windows, one agent.** airlock can have several windows open at once, each
> with its OWN open folder. There is still **one agent session at a time** (you), and you
> operate on the **last-focused window's project** — the window the human is actually using.
> If they switch windows, your "current project" follows: the folder, git, secrets,
> databases, and `get_terminal_tail` all resolve to that last-focused window. So treat
> "the project" below as the last-focused window's folder, and don't assume the human is
> looking at the same window between calls.

## The panes

airlock's window has three regions:

- **Sidebar** (left, can be moved to the right or hidden) — a stack of collapsible
  sections: Files, Secrets, Git, Activity, Databases, Docker, Host, Audit. This is the
  project's status at a glance. You can read every section's live status and you can show/hide
  sections to curate what the human sees (see `tools.md`). Pinned at its bottom-left is an
  account-wide **Claude usage meter** (the 5-hour and 7-day plan windows); clicking it opens
  the Usage dashboard. You can read the same data yourself with `plan_usage`.
- **The main area is terminal-first.** By default it is just the terminal — that is where you
  live, the primary surface. The human can also open files, git diffs, and database tables
  here as tabs alongside the terminal, and can **split the area into a multi-pane scene**
  (terminals and/or files side by side). When nothing else is open, the terminal fills it.
- **IDE page-tabs.** Settings and the Usage dashboard open as their own top-level page-tabs in
  the tab strip (both can be open at once), separate from the project/folder tabs. You can
  open/close them too — `open_app_page` / `close_app_page` (`ide-control.md`), e.g. surface
  the Usage dashboard when the human asks about their plan usage.

## The one crucial fact

You can **read every status** airlock tracks (git, databases, Docker, Neon, Render, the
host dev server, secret *names*, your own Claude plan usage), you can **drive the sidebar**
(list sections, show or hide them), and you can **drive the focused window's layout**
(open/close/switch tabs, split, open/close terminals, open/close the Settings/Usage
page-tabs - see `ide-control.md`). 

But you can **never read a secret value.** That is airlock's entire reason to exist: the
human's API keys, database passwords, and tokens live in the OS keychain and are only ever
used main-side (e.g. injected into a terminal at spawn, or used to open a short-lived
database connection). No tool returns a value, and there is no path for you to obtain one.
You can see that a secret named `OPENAI_API_KEY` exists, that it is a valid-looking key,
and that a database is reachable — never the secret itself. Don't ask for values, don't
try to read them from disk, and don't treat their absence as a problem to solve. See
`security-model.md`.

## How to use this manual

- `tools.md` — the MCP tools and when to reach for each.
- `ide-control.md` — the nine tools that drive the focused window's tabs / split /
  terminals / page-tabs (layout metadata only, no secret values).
- `security-model.md` — the no-secrets invariant in plain terms.
- `sidebar-*.md` — one file per sidebar section: what it shows and **when it is useful**
  for a given project, so you can curate the sidebar to match the project in front of you.
