# Changelog

All notable user-facing changes to AirLock. Dates are when the version was cut.

## 0.5.0

### Added
- **Extension Hub.** A new "Extensions" sidebar view lists every integration
  grouped by state (Connected / Available / Not installed / Disabled), with
  enable and pin toggles and one-click Install / Connect actions. Category
  integrations (Snowflake, Azure, Vercel) appear under Databases / Host only
  when you pin them, so the sidebar stays clean by default.
- **Connect Slack in one click.** Slack connects through your browser via a
  hosted OAuth broker (no pasted token), then a channel allow-list "permission
  wall" lets you choose exactly which channels Claude may read. Two gated MCP
  tools (`slack_read_channel`, `slack_list_allowed_channels`) let Claude pull
  that context; the token stays in the main process and never reaches the model.
- **Connect GitHub with a device login.** GitHub connects with a device-code
  sign-in (no secret, no pasted token); a `github_read_issue` MCP tool reads an
  issue through the vaulted token.
- **Events panel.** A new "Events" sidebar view with a live feed you can filter
  by level and category, backed by a size-rotated on-disk log with a
  secret-redaction safety net. A `read_events` MCP tool lets Claude query it.
- **Managed dev servers.** Start / Stop / Restart your project's dev server from
  the HOST view, or let Claude drive it with the `start_dev_server` /
  `stop_dev_server` MCP tools. AirLock discovers the served port and tracks
  liveness, and an already-running unmanaged server can be adopted in place.
- **Inline Excel viewer.** Open `.xlsx` / `.xls` / `.xlsm` files as a formatted,
  multi-sheet table (bold, italic, color, fill, alignment, and merged cells).
- **Inline PDF viewer.** Open `.pdf` files directly in a tab.
- **Render environment variables in the sidebar.** Expand a Render service to
  see its env keys (masked, reveal on click) and run a value-free dev vs prod
  comparison.
- **Tabbed Settings.** Settings now has a left category rail (Appearance,
  Layout, Terminal, Claude, Secrets, Agent, About) instead of one long scroll,
  plus per-section sidebar-visibility toggles and an About tab (version, MCP
  port, and update check).
- **Let Claude run your app.** An opt-in skill (Settings → Claude) routes
  Claude's "run the app" requests to AirLock's managed dev server, so the IDE
  shows and manages the process.
- **Drag files onto a terminal** to paste their absolute path(s), the way the
  macOS Terminal does.

### Changed
- **Per-project MCP scoping.** Claude's MCP tools now resolve to the calling
  session's project (via a per-session token) instead of whichever window last
  had focus, so tools act on the right project across multiple projects and
  windows. AirLock also migrated off the old account-wide MCP registration.
- **Session restore falls back to a fresh Claude** when a restored tab has no
  resumable conversation, so a restored tab never lands on a dead
  `claude --continue` prompt.

### Fixed
- **The tab "working" dot** lights again on Claude Code 2.1.199: detection is
  re-anchored on the live elapsed-timer footer after Claude Code dropped both
  the "esc to interrupt" hint and the trailing "…".
- **Terminal drag-and-drop** now fires over the terminal (native listeners)
  instead of silently doing nothing, for both Finder and file-tree drags.
- **The project Overview** renders README HTML wrappers and shields.io badges as
  clean labelled links instead of leaking raw `<div>` / `<img>` tags.
- A shared **"Open a folder first" empty state** (with an Open Folder button)
  now appears across Secrets, Databases, Git, Audit, and Files.

### Internal
- New OAuth platform: a stateless Cloudflare Worker broker that holds only
  client secrets (never user data) for providers whose token exchange requires a
  secret, an `airlock://` protocol handler for the browser callback, and a
  device-flow engine for secret-less providers.
- Structured event-logging pipeline (buffered writer, size-rotated file sink,
  and reused secret redaction) underpinning the Events panel and `read_events`.

## 0.4.0

### Added
- **Project Overview dashboard.** A new per-project dashboard tab with live
  status, a language/tech bar (monochrome tech-logo tiles), and your rendered
  README. A "Generate / Refresh" button asks the project's Claude to write an
  `overview.md` (and is instructed to keep secrets out of it); the result is
  rendered as safe, HTML-inert markdown where in-repo links open the file in the
  editor. Multiple project overviews can be open at once.
- **Session restore.** Opt in (Settings) to have AirLock reopen the projects,
  tabs, and splits you had on quit, then resume each tab's Claude session
  (`claude --continue`) when you focus it. Survives restarts.
- **Control your hosting from the sidebar.** Azure Web App rows expand to show
  State / Region / URL with Start / Stop and Open-in-Portal actions; Render
  service rows show type / region / plan / branch / last deploy, recent deploy
  history, and Site / Dashboard / Manual-Deploy buttons (with confirm).
- **Neon org tree + multiple accounts.** Browse Neon as Org → Project → Branch →
  Database → Table, and connect a different API key per project (personal or
  organization keys), gh-style. Pick an existing account or add/remove one.
- **Activity-bar status dots.** Each section (Host, Databases, Docker, Git,
  Activity) shows a green / yellow / red / grey health dot at a glance.
- **Git change context menu.** Right-click a changed file to view its diff, open
  it, stage / unstage, copy its path, or discard it, plus **Undo last commit**.
- **Cmd+click a file path in any terminal** to open it in the editor.
- **Drag to reorder tabs** in both the project strip and the main tab bar.
- **Resize the sidebar** by dragging its border (the collapse button is gone;
  the activity bar covers it).
- **Gated terminal input for Claude (MCP).** A new `send_terminal_input` tool
  lets the agent type into a terminal only after you approve it in a grant modal.

### Changed
- **A project's secrets are stored as a single Keychain item** (instead of one
  per secret), cutting Keychain access prompts from many to one per project. A
  one-time migration folds existing secrets in with no loss.
- **Host sections are scoped to the current project and auto-reload when you
  switch projects**, so you no longer briefly see another project's Render / Azure
  / database resources. Account-wide integrations (Azure, Snowflake, Vercel) only
  appear under the projects that use them; Render is matched strictly to the
  project's repo.
- **One Refresh button for the whole HOST view**, always visible.
- **The Audit log now records git, file, and integration actions** (not just
  secret access) in a live, readable feed with per-entry actor badges (you vs.
  Claude), friendly labels, and a one-line summary.

### Fixed
- **File-watcher file-descriptor exhaustion (EMFILE)** that could show up as
  blank terminals and dropped MCP connections: the watcher now uses FSEvents and
  ignores dependency/build/cache directories (`node_modules`, `venv`,
  `__pycache__`, `target`, `.claude`, …).
- **Keychain re-prompt loop**: a session read-cache and denial backoff stop the
  repeated access prompts.
- Neon: a project-scoped key now shows a clear "use a personal/org key" hint
  instead of a raw 404, and organization keys are identified correctly.
- Render: deactivated services no longer show a red status dot.
- Claude auto-start no longer inherits a project's injected `ANTHROPIC_API_KEY`.
- The tab "working" dot matches Claude Code v2.1.185's footer again.

### Internal
- Migrated the file watcher from chokidar to `@parcel/watcher` (FSEvents,
  O(roots) file descriptors).
- macOS signing reworked so local rebuilds re-sign with a stable identity
  (fewer Keychain re-prompts); added the microphone entitlement so Claude
  Code `/voice` works inside AirLock.

## 0.3.0

### Added
- **Connect a database with a connection string.** A "+ Add database" button in
  the Databases sidebar opens a modal to paste a `postgresql://…` connection
  string (Neon or any Postgres) and browse its tables. The password stays in the
  main process and never reaches the renderer or the AI model.
- **Database & Neon tables open as tabs.** Browsing a table now opens a
  persistent, switchable, closable tab in the main tab bar instead of a
  full-pane overlay.
- **Remove a database** directly from the Databases section (per-row button).
- **Terminal keyboard text selection** on the current command line:
  `Cmd+Shift+←/→` selects to line start/end, `Option+Shift+←/→` selects/extends
  by word, and `Cmd+C` copies the highlight.
- **CLI integrations.** Manifest-driven status panels for the **Vercel**,
  **Snowflake**, and **Azure** (Web Apps) CLIs, shown in the
  Databases/Host sidebar with Install/Connect buttons when a CLI is missing or
  unauthenticated, plus integration status in the Activity feed.
- **Choose your terminal.** Pick a default external terminal (iTerm, Ghostty, …)
  in Settings; new terminals open there.
- **Find All References** in the editor, via right-click → Find All References or
  `Shift+F12`, with a results overlay.

### Changed
- **Standardized sidebar layout.** Every section (Files, Git, Secrets,
  Databases, Neon, Integrations, Docker, Host, Render, Activity, Audit) now
  shares one layout grammar: uniform control heights, spacing, equal-width
  toolbar buttons, row actions, inputs, and empty states.
- **Neon Connect panel** gained a **Disconnect** button, and the connect field
  now rejects a Postgres connection string pasted where the API key belongs.
- **HOST view** uses consistent full-width Connect / Set-URL buttons; a
  connected integration with nothing to list now shows "no resources" instead of
  a blank header.

### Fixed
- The Neon panel no longer gets stuck on "401 Unauthorized" with no way to clear
  a bad/stale key.
- HOST dev-server detection: detect by subdirectory + probe, re-probe every 5s
  while focused, and stop reporting macOS AirPlay (port 5000) as a live server.
- Window first paint no longer collapses; the status bar no longer balloons in
  multi-window mode; status-bar divider + terminal overflow clipped at the grid
  seam.
- Usage dashboard: corrected liveness, per-model attribution, and reset-time
  display.

### Internal
- The renderer no longer bundles native modules (agent-core boundary enforced),
  fixing a packaging break.
- Connection-string validator requires real `user:password@host` credentials so
  a credential-less URL can't silently fail to appear.

## 0.2.0

- Prior release (terminal-first IDE shell, projects/tabs/splits, Secrets vault,
  Databases browser, Claude quota meter + usage dashboard, Claude auto-start).
