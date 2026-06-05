# airlock

> Working title. A terminal-first AI IDE where the agent can build, run, and
> debug your app — but is structurally unable to read your secrets.

**Status:** skeleton + secrets + git + DB + Docker + Host + sidebar
customization + an MCP IDE-bridge. A multi-terminal panel (tabs, split, rename),
file tree, viewer split, keychain secrets with terminal injection, hash-chained
audit, a live git sidebar (stage/commit/branch/diffs), GitHub account switching,
a settings tab with dark/light themes, live Postgres database browsing, Neon
project/branch/database browsing, live Docker container control, a Host section
(local dev-server status + Render deploy status), and per-section sidebar
show/hide all work. airlock also runs a local MCP server so the Claude Code in
its terminal can read every status and curate the sidebar — never a secret
value. The full agent phase is next.

Spec: `docs/superpowers/specs/2026-06-03-airlock-v1-design.md`

## Dev

```bash
npm install
npm run rebuild   # rebuild node-pty for Electron's ABI
npm run dev       # launch the app
npm test          # agent-core + renderer unit tests
npm run typecheck
npm run lint
```

macOS only for now (by design — see spec §2).

## Package (real airlock.app for daily use)

```bash
npm run package   # → packages/app/release/mac-arm64/airlock.app
```

Drag it to /Applications (or the dock). Unsigned — local use only.
Note: in `npm run dev` the dock may still show "Electron" (the dev binary's
identity); the packaged app shows the airlock name + icon everywhere.
To rebrand: replace `packages/app/build/icon.svg`, run
`bash packages/app/scripts/make-icon.sh`, re-package.

## Terminal

The terminal owns the main area and is a full multi-terminal panel:

- **Tabs** — `+` spawns a new terminal; click a tab to switch; `✕` kills it
  (closing the last tab respawns a fresh one). Tab titles track the running
  process via the shell's OSC title sequences.
- **Rename** — double-click a tab to name it; a manual rename pins the title so
  later OSC updates stop overwriting it.
- **Split** — show two shells side-by-side; the split button toggles it off.
- **Layout** — a top-right cluster in the title bar shows/hides the sidebar and
  flips it (left ⇄ right); both are remembered across launches. To go
  terminal-only, hide the sidebar and close the viewer with its ✕.

Every terminal stays alive in the background, so buffers survive tab switches.
Secrets are injected at spawn, so they apply to **new** terminals only — after
toggling injection, the secrets panel offers a "restart active" hint that
replaces just the active terminal with a freshly injected one (other running
terminals keep their existing env).

## Secrets

Secrets live in the macOS Keychain (service `airlock`), scoped per project.
Add them in the sidebar, or `Import .env` to vault an existing file (it is
deleted after import only when every entry vaulted cleanly). Toggle "inject
into terminal" and new terminal sessions receive them as env vars — no
`.env` on disk, ever. Loader-hijack names (PATH, DYLD_*, NODE_OPTIONS...)
are stripped at the spawn site and audited. Every broker operation lands
in `.airlock/audit/log.jsonl`, hash-chained.

Secrets only reach **new** terminals (injected at spawn), and each terminal
inherits your login-shell `PATH`/locale — so homebrew tools and `LANG` work
even when Airlock is launched from Finder.

Note: the packaged app is ad-hoc signed; after re-packaging, macOS may
re-prompt Keychain access once per rebuild ("airlock wants to access...").
Click Always Allow. A real signing identity would make this stick.

## Git

The sidebar shows the current branch (switch or create from the dropdown),
staged/unstaged changes with one-click stage/unstage, and a commit box.
Click any changed file for a unified diff in the viewer split. Push, pull,
merge, and anything else: the terminal is right there.

## Databases

The sidebar lists your Postgres connections, sourced from any secret you've
vaulted with the `postgres-url` provider — so add a connection string in
Secrets first, and the database shows up here (host and database name shown,
password never). A live status dot reports reachability (grey while checking,
green for a `SELECT 1` that connects, red when it fails); a refresh button
re-checks. Expand a database to see its tables, then click a table to browse
its rows in a **read-only** data grid in the viewer split (first 100 rows).
The connection string is read in the main process only — the password never
crosses into the UI.

### Neon

At the top of Databases is a **Neon** group. Click **Connect Neon** and paste an
API key from the [Neon Console](https://console.neon.tech) — it is stored in your
keychain, read in the main process only, and never seen by the agent. Once
connected, browse your account as a tree: **projects → branches → databases**.
Each database gets the same live status dot, expands to its tables, and opens any
table in the read-only data grid (first 100 rows). The API key and the
per-branch connection string stay in the main process — only table and row data
reach the UI.

## Docker

The sidebar lists your local Docker containers, each with a live status dot
(green when running) and a one-click start/stop. It refreshes on focus and on
demand. Needs the Docker daemon running — if Docker isn't installed or the
daemon is down, the section says so instead of erroring. Not tied to an open
folder (Docker is machine-wide).

## Host

The sidebar's **Host** section shows where the current project runs.

**Local** — your dev server. airlock resolves its URL from
`.airlock/config.json` (set or edit it inline) or guesses it from
`package.json` (Next, Vite, CRA, Astro defaults). A live dot reports up/down
via a quick TCP probe (refreshes on focus and on demand), and an
open-in-browser button launches it in your **system** browser.

**Render** — your services' deploy status. Click **Connect Render** and paste a
Render API key — it is stored in your keychain, read in the main process only,
and never seen by the agent. Once connected, airlock lists the services for the
open project (matched to its git remote, or all services if none match), each
with a live status dot for its latest deploy, a check for whether your **latest
commit is live** (Render's deployed commit vs your local `HEAD`), and an
open-in-browser link. The API key never leaves the main process.

## GitHub accounts

The sidebar footer's person icon opens a popover listing every account
`gh` is logged into (across hosts), with a filled dot on the active one.
Click another to switch it (`gh auth switch`), and a warning appears when
the active GitHub account differs from the open repo's commit name. `gh`
redacts the token, so airlock manages accounts without ever seeing
credentials. Needs the GitHub CLI (`gh`) installed.

## Settings & Themes

The sidebar footer's gear icon opens a menu: **Settings** opens a tab in
the viewer split (Appearance, Layout, and — with a folder open — Secrets),
and **Themes** flips the whole app between **dark** and **light**. The
theme is app-global and remembered across launches (in `prefs.json`); the
terminal and editor re-theme in place without losing their state.

## Customizing the sidebar

Every sidebar section — Files, Secrets, Git, Databases, Docker, Audit — shows by
default, and you can hide any you don't need. Right-click a section's header and
choose **Hide**, or uncheck it under **View ▸ Sidebar**. Re-show a hidden
section by re-checking it in that same menu. The choice is app-global and
remembered across launches, separate from simply collapsing a section (which is
not saved). Hide everything and the sidebar points you back at View ▸ Sidebar.

## Claude in your terminal can drive airlock

airlock runs a small local MCP server, so the Claude Code you already use in
airlock's terminal can see what airlock sees and curate it for you — no extra
setup, no second API key. The terminal Claude *is* the agent; airlock is just
the tool and resource provider.

**What it can see.** Every live status the sidebar shows: your databases (host
and reachability), Neon projects/branches/databases, Docker containers, Render
deploy status, the git branch and changes, the local dev-server host and
up/down, which sidebar sections are visible, and your secret *names*. It also
reads a built-in manual (one page per sidebar section, plus the security model)
so it understands the IDE without you explaining it.

**What it can do.** Curate the sidebar for the project — show or hide any
section. So you can ask "set up my sidebar for this project" and it will turn
on Databases and Docker, hide what you don't need, and the sidebar updates live.

**The security boundary.** Claude can never read a secret value through airlock —
**the tools to do that do not exist.** Every read returns names, hosts, and
status only; `getSecretValue`/`getGlobalSecret` are never exposed as tools, and a
test enforces that the only tools registered are the read/curate set (so a future
tool that would leak a value fails the build). The server listens on `127.0.0.1`
only, behind a bearer token airlock generates. This is the same no-secrets rule
the rest of airlock follows — now on a second surface.

**On first use, you approve it.** Open a project and Claude Code prompts you to
approve the `airlock` MCP server; the first time it wants to change the sidebar,
Claude Code asks you to approve that tool too. Nothing happens behind your back.
(airlock registers itself in Claude Code's *local* scope, keyed to the project —
so no file is written into your repo.)

## Credits

Icons: [@vscode/codicons](https://github.com/microsoft/vscode-codicons) (CC-BY-4.0).
