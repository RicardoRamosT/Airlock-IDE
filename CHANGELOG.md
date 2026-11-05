# Changelog

All notable user-facing changes to AirLock. Dates are when the version was cut.

## 0.8.0

### Added
- **Your whole portfolio, down the right edge.** A slim strip runs down the
  right of the window with one dot for each project in Atlas's debrief: red
  when CI is failing, amber when something is waiting on *you* (a pull request
  of yours nobody has reviewed), green when a project is clean, grey when it
  has nothing to say. Hover a dot for the one-line reason. Click it to open
  that project's Atlas over your work, with its own chat thread, its own report
  from the debrief and only its own open concerns. Nothing resizes or reflows
  underneath, and clicking back into your work closes it. Every project keeps
  its dot in a fixed position, so after a day or two you know which one is
  which without reading anything. The Atlas mark now sits at the far right of
  the title bar, at the head of the strip, and opens the portfolio-wide
  conversation the same way; the notifications bell moved left of it.
- **Atlas has its own settings, and you choose which projects it covers.** The
  panel's header is now two tabs (Debrief, Chat) and a ⋯ menu holding History,
  New chat, Open in a window, and a new Atlas settings screen. The debrief hour
  and where Atlas appears moved there from the Settings tab, joined by a list of
  every project Atlas knows about with a switch each. **Projects start switched
  off**, so after updating, Atlas will ask you to choose before it writes
  another debrief. Switching one off keeps it out of the morning debrief only:
  Atlas still watches it, still raises concerns about it, and can still answer
  questions about it in chat. The screen also says what a debrief costs
  (roughly 20K to 50K tokens for each enabled project that saw work; quiet ones
  are free).
- **Your projects now brief Atlas themselves.** Before the debrief is written,
  every project that saw work files a report: everything that happened to the
  code, read exhaustively rather than sampled (commits, pull requests, CI runs,
  issues, releases and what is still uncommitted), plus a short account of what
  the work was and where it stands, distilled from that project's own Claude
  sessions. You should not have to explain yesterday to Atlas any more. When
  something cannot be read, the debrief says so instead of quietly reporting
  nothing.
- **ESLint in the editor.** A project's own ESLint problems now show in the
  editor beside TypeScript's, with a **Fix** action wherever ESLint offers one.
  Running a project's ESLint means running code from that repository (its
  config and every plugin), so nothing runs until you click **Enable ESLint
  here** for that folder. The permission is stored outside the repository,
  where a committed file cannot forge it, and the ESLint chip in the editor's
  breadcrumb shows the status and turns it off again. AirLock only ever runs
  the project's own ESLint, installed inside the project, with that folder's
  own config, and an edited config takes effect without a restart.
- **Markdown files open rendered.** A `.md` file opens as a GitHub-style
  preview (headings, tables, task lists, highlighted code) with a
  Preview | Edit toggle; Edit is the normal editor, autosave included. Links to
  other files open them in AirLock, web links open in your browser, and the
  preview follows the file on disk, so edits Claude makes appear as it makes
  them.
- **YAML is syntax-highlighted.** `docker-compose.yml`, GitHub workflows and
  other YAML files were one flat colour. Keys now stand out from values, in the
  editor, the diff view and markdown code blocks.
- **AirLock tells you about apps left running for days.** Dev servers and
  Docker containers belonging to your projects that have been up for more than
  24 hours appear in the notification bell, with the project they belong to
  and a Stop button. Nothing is ever stopped for you. It covers every project
  AirLock knows about, not only the open tabs, and includes servers started
  from an AirLock terminal, by you or by Claude. The threshold and an off
  switch are under Settings → Local apps.
- **The sidebar shows the services this project actually uses.** Docker, Neon,
  Render, Snowflake and Azure now appear on the rail, and as rows under
  Databases and Host, only in projects that use them. Detection reads the
  project's dependencies, config files and the *names* of its `.env` keys
  (never the values), so a Python service on Azure is recognised as well as an
  npm app. When it guesses wrong, **Use it here** in the Extensions hub turns
  one on for that project.
- **Paste a screenshot into the Atlas chat.** Atlas reads it like any other
  file.

### Changed
- **Approving Claude's typing into a terminal is now optional, and off by
  default.** Claude already runs commands in your terminals, so a separate
  approval before it types into one it is already driving was friction more
  than protection. Turn it back on with Settings → Claude → "Ask before Claude
  types into a terminal".
- **Turning on "Secrets in terminals" now asks first.** That switch puts every
  vaulted value into every terminal's environment, which the threat model
  calls the most important decision in AirLock, yet it rendered as a dim
  checkbox. Enabling it now shows a confirmation that spells out what it does,
  and the row stays amber while it is on. Turning it off never asks.
- **The Claude status pill tracks only what AirLock uses.** It used to show
  Anthropic's page-wide status, so a problem in an unrelated product (Claude
  Cowork on Windows, for days) read as "Claude Degraded". It now watches
  Claude Code and the Claude API, and names which one when something is wrong.
- **Atlas lives in the title bar and the strip.** The Atlas sidebar section is
  gone (it was the same panel, already one click away), and the menu bar item
  no longer carries a dot.
- **Split view says which project the sidebar is acting on.** Git, Secrets,
  Databases and Claude's actions all target the focused pane, so the focused
  pane's ring is thicker and the sidebar carries the same accent.

### Fixed
- **Claude's actions land in its own project.** When a project's Claude opened
  a terminal, switched or closed a tab, or started the dev server while you
  were working in another project, it did it in the project you were looking
  at: a terminal opened there with that project's secrets in it, or that
  project's dev stack started instead of its own. Each project's Claude now
  acts only on its own tab, and never takes the screen away from you.
- **Answering Claude's secret request no longer kills its session.** With
  "Secrets in terminals" on, saving the secret restarted the active terminal,
  which was usually the one running the Claude that asked, ending it and its
  subagents mid-turn. That terminal is now left alone; Claude reads the new
  value without a restart. Adding a secret yourself still restarts the terminal
  as before.
- **Claude only sees this project's Docker containers.** Asked about Docker,
  Claude was handed every container on the machine with nothing saying whose
  they were, and could inspect another project's database believing it was
  this one's. Containers are now matched to their project, and other projects'
  containers are only counted.
- **A torn-off window can be merged back in.** Dragging a tab out into its own
  window worked, but dragging it back onto another window did nothing, even
  though that window said "Drop to add here". It now merges, and the emptied
  window closes. A terminal moved between windows also redraws whole, instead
  of Claude Code's input box arriving with lines missing.
- **The quota meter follows your current Claude account.** After switching
  accounts it could keep showing the old account's weekly usage indefinitely.
- **A tab no longer shows Claude working while it is idle.** A duration in
  parentheses left on screen, such as "(2m36s in your case)" in an answer,
  could pin the tab's indicator to working for hours.
- **The dock badge is right more often.** It turned green while a workflow's
  subagents were still running, and stayed yellow forever after a turn was
  interrupted with Escape. Only notifications that really hand control back
  count as finished now, and the badge goes grey once Claude stops writing to
  its session. (A single tool call that runs silently for more than five
  minutes can read grey until it returns.)
- **Long Atlas runs are no longer killed at 15 minutes.** A run that was still
  working was stopped and its work thrown away. Atlas now stops a run only
  after 5 minutes with no output, and a failure shows its actual reason
  instead of "Could not reach Claude".
- **What Atlas types into a terminal actually arrives.** Its messages sat
  unsent in a Claude session's input box, a terminal it opened to run commands
  started Claude instead of a shell, it could not read a terminal's output,
  and its signature broke every command in zsh. All four are fixed. What Atlas
  types into another Claude session is signed, so that session knows the
  message came from Atlas and not from you.
- **Atlas's stored debriefs could be cut short.** Some debriefs ended mid-word
  and some project snapshots were unreadable, with no error anywhere. The cause
  was a text-length miscalculation on the way into storage; writes are now
  checked, and a short one is retried and then reported. Debriefs that were
  already cut short cannot be recovered.
- **Atlas's project list stays true.** A newly opened project appears in Atlas
  settings straight away instead of after the next debrief. A deleted folder is
  flagged the next time you look, not the next day, while one that merely could
  not be checked (an unmounted drive, a pending macOS permission) is no longer
  treated as gone. A missing project has a **Remove** button, which forgets it
  in Atlas only, never touches anything on disk, and stays removed.
- **"Still open" no longer buries the debrief.** The list of open concerns has
  its own scroll, collapses from its header, and can be resized by dragging the
  line above it. It also shows before the day's debrief has been written.
- **A project with a nightly build no longer appears every morning to say
  nothing.** Any CI run counted as activity, so a repository whose only event
  was a passing scheduled build was never quiet. Only a failing run now brings a
  project into the debrief on its own.
- **CI is read as the project's pinned GitHub account.** Projects pinned to an
  account other than the active one were asking GitHub as the wrong user, and
  the answer (a 404) looked exactly like a passing build with no CI row.
- **A skipped day no longer vanishes from the debrief.** The debrief covered a
  fixed 24 hours, so work done on a day you did not open AirLock was never
  reported by any later debrief. It now runs from your last debrief.
- **A busy day is no longer truncated.** The debrief listed at most 20 commits
  per project and silently dropped whole projects when the prompt got long.
- **Claude's request cards could go missing.** A secret request raised while
  Atlas's own window was focused was addressed to a window that never shows
  cards, and expired unseen. A tall Atlas panel could also cover the cards.
- **Smaller fixes.** The Usage page read long API times as minutes ("4578m
  31s"); it now uses hours. Toolbar buttons with longer labels ("Import .env",
  "+ Add database") no longer wrap their text inside the button. Closing a page
  no longer reopens a sidebar you had deliberately closed.

## 0.7.0

### Added
- **Atlas, an administrator for everything you are working on.** A new sidebar
  section, and optionally a macOS menu bar item, that keeps track of your whole
  portfolio rather than one project. It writes you a debrief when you sit down
  (once a day, at an hour you choose), and you can talk to it all day about
  anything: it reads your projects, searches the web, runs commands, and opens
  tabs or terminals in AirLock for you. It remembers what you tell it in your own
  words (deadlines, priorities, what is parked), and asks about something it has
  believed for a long time rather than letting it quietly rot. Atlas uses your
  Claude subscription, and tells you what it will cost before it spends anything.
- **Atlas keeps a list of what it is still worried about.** Things with a
  consequence and a clock (a deadline coming up, a blocker that has not moved,
  commits that exist only on your machine) now appear under "Still open" with how
  long they have been true and whether the number is growing (`28 → 44`).
  Previously the debrief was written from scratch each day, so the same warning
  arrived word for word every morning with no sense that it had been ignored for
  a week. Each one has a "Look into this" button that hands it to the chat for a
  proper investigation. Telling Atlas a project is parked quiets its concerns
  without forgetting them.
- **Atlas can capture the screen.** Ask it for a screenshot or a recording and it
  will, which is useful before a meeting or when you want a record of something.
  macOS asks for Screen Recording permission the first time. Because AirLock is
  not yet notarised, that permission is tied to each build's signature, so you
  may be asked to grant it again after an update.
- **Copy any message in the Atlas chat.** Hover a message and click Copy. You get
  the original markdown, so it pastes correctly into anywhere that renders it.
- **Start auto-started Claude sessions without permission prompts.** A new option
  under Settings → Claude runs auto-started sessions with
  `--dangerously-skip-permissions`, for people who always work that way and were
  having to exit and retype the command in every new terminal. Off by default.
  Note that AirLock also injects the project's vaulted secrets into every
  terminal, so a session started this way has both no prompts and real
  credentials available to it.
- **Claude can fetch a credential it is not allowed to see.** When a value lives
  in neither `.env` nor the vault but a CLI can produce it, Claude runs the fetch
  and the output goes straight into a session-only store, never into the
  conversation on success. It can then use the value without it ever being
  displayed. (A failed fetch still reports a short error excerpt, so Claude can
  see what went wrong and try again.) Previously the only route was pasting the
  credential into the terminal yourself, which put it in the transcript in
  plaintext.

### Changed
- **Claude's prompts no longer take over the screen.** When Claude needs a secret
  or asks to type into a terminal, it now appears as a small card in the
  bottom-right instead of a dialog in the middle of everything. Nothing steals
  your focus, so you can keep typing and deal with it when you want. Dismissing a
  card sends it to a new notification bell in the top-right rather than throwing
  it away, so one you close by accident, or mean to handle later, is still there.
  Several requests can now wait at once; previously a second one was simply
  refused while the first dialog was open.

### Fixed
- **AirLock could close unexpectedly while Atlas was working.** A fault deep
  inside Node's SQLite binding could terminate the whole application, taking
  every window, terminal and running Claude session with it. Atlas's storage now
  runs in its own separate process, so the same fault costs a single failed write
  and nothing else. The bug is upstream, not AirLock's, but the damage it could
  do was.
- **The editor could overwrite a file that changed on disk.** If Claude, a
  formatter or `git switch` rewrote a file you had open, typing a single
  character would put your older copy over the top of it about a second later,
  and report it as saved. The editor now notices and offers to reload or keep
  your version, and it will not overwrite without you choosing. Saves are also
  written atomically, so a crash mid-save can no longer leave a source file
  empty, and the last second of typing is no longer lost when you close a window
  or quit.
- **Closing a window left its terminals running.** Every shell in a closed window
  kept going invisibly, including a Claude session mid-task that was still
  editing files, until you quit AirLock entirely. Reloading a window did the
  same. They are now shut down with the window that owned them; tearing a tab out
  into a new window still moves its terminals across alive.
- **AirLock could replace your Claude Code settings file.** If
  `~/.claude/settings.json` could not be read (a stray comma is enough) AirLock
  treated it as absent and wrote its own settings over the top, losing everything
  else in it. The same flaw could reset your AirLock preferences or a project's
  configuration, and a declined keychain prompt could overwrite a project's
  entire secret vault with a single entry. In every case AirLock now refuses to
  write rather than assuming an unreadable file is an empty one.
- **The app could freeze for as long as something else took.** Several background
  checks ran without any time limit, so a slow network drive, an unhealthy Docker
  daemon or a keychain prompt could stall every window at once, a beachball that
  looked exactly like a crash. Everything AirLock runs now has a deadline, and
  the keychain no longer blocks the interface while macOS asks for permission.
- **File watching could stop silently.** After certain errors AirLock quietly
  stopped noticing changes on disk in a project, so the file tree drifted out of
  date with no indication anything was wrong.
- **Atlas no longer loses a message while it is thinking.** Your question is
  saved the moment you send it, so closing the panel mid-answer and reopening
  shows it still in progress instead of appearing to have vanished. If Atlas is
  interrupted, by a quit or by a failure, it says so rather than silently
  dropping what you asked.
- **Projects stop fighting over your GitHub account.** Pinning a project to an
  account is supposed to make every push from that repo use it, whatever account
  is active elsewhere. But a pin could go stale without ever saying so: anything
  that ran `gh auth setup-git` in the repo, including an agent trying to get past
  a failed push, quietly swapped AirLock's per-account credential for a generic
  one that just uses whichever account happens to be active. The project still
  showed as pinned while its pushes went out as the wrong user, so the fix looked
  like switching accounts, which then broke the next project. AirLock now checks
  the pin is genuinely in force each time you focus a project, and repairs it if
  not. Pins made before this check existed are repaired the same way.
- **Focusing a pinned project no longer switches your active GitHub account.** A
  pinned project carries its own credentials, so there was never a reason to move
  the machine-wide account when you clicked its tab, and doing so meant a push
  running in the background from a different project could go out as the wrong
  user.
- **The dock badge dropped to grey while Claude was still working.** AirLock only
  learned a session was busy when you submitted a prompt, or when a tool call
  finished. But a turn can resume without any prompt being submitted (feeding `!`
  shell output back into the conversation does exactly that), and if its first
  move is a long tool call, nothing said "busy" until that call returned. Four
  straight minutes of real work read as idle. Tool starts now count too.
- **The licence now ships with the app.** AirLock is free for noncommercial use
  and needs a paid licence at a company, but neither document was in the
  installed app: they existed only in the repository, so anyone who installed
  from the DMG had no copy of the terms and no way to find out that a commercial
  licence exists. Both are now in the bundle and readable from Settings → About.
- **Electron's and Chromium's notices ship too.** Chromium's licence requires its
  notice travel with anything built on it, and the macOS build was leaving both
  files behind. They are in the bundle now, alongside a credit for the icon set.

## 0.6.2

### Fixed
- **A phantom "Release to open … in a new window"** label used to follow your
  cursor whenever it left AirLock, with no drag behind it. Reordering a project
  tab once was enough: the drop cleared the strip's drag state before `dragend`
  ran, so the drag never ended as far as the window-tracking was concerned, and
  its cursor poll kept running for the rest of the session.
- **AirLock's dock icon lost its status badge and the running-app dot** the first
  time that label appeared — permanently, until you relaunched. Showing a window
  on every macOS workspace hides the app's whole dock tile, and nothing put it
  back. It is restored now, badge and all.
- **Claude Code's input box no longer hides under the bottom bar** after a
  display change. Moving the window to a differently-scaled screen, switching
  resolution, or waking with a monitor attached changes how tall a terminal row
  actually renders without resizing anything — so the terminal kept one row too
  many, and the row that fell off the bottom was the one you type in.

## 0.6.1

### Added
- **Slack in the sidebar.** Slack gets its own section with a real chat
  transcript for the channels you allow-listed: message history that pages
  further back on demand, full emoji, avatars, and attachment chips that open
  the file in a tab (downloaded through the same gate as everything else, into
  `.airlock/slack`). Expanded channels refresh every 30s and pause when hidden.
  When Slack refuses a read, the panel says *why* instead of showing an empty
  list.
- **Connect a Slack workspace once, use it in any project.** Workspaces are
  pooled — one keychain entry each — and a project binds to one with a single
  click. Nothing auto-binds: an unbound project is not connected no matter how
  many workspaces you have pooled, because the click is what keeps projects
  isolated. Older per-project tokens fold into the pool on first read.
- **Choosing the right Slack workspace, and proving it.** The connect modal
  lists the workspaces your Slack desktop app knows about (names only, never
  tokens), takes a pasted URL/domain/slug/team id for browser-only workspaces,
  and authorizes on that workspace's own subdomain rather than the generic host.
  After connecting, `auth.test` verifies which workspace you actually got — a
  mismatch holds the dialog open with Keep or Try again.
- **The Extensions hub is a full page.** Every integration grouped by real
  connection state — Connected / Not connected / Not installed / Disabled —
  with a detail pane per extension, real on/off switches instead of checkboxes,
  and brand marks. Neon, Docker, Render, Snowflake and Azure are now extensions
  too, so one place lists everything.
- **"Use it here."** Azure and Snowflake only appear in projects that use them,
  detected from a vaulted `AZURE_*` / `SNOWFLAKE_*` secret or an `azure.yaml`.
  When the guess is wrong, one button opts the project in explicitly, and the
  hub carries a per-project switch to turn it back off.
- **CI in the Git section.** The latest GitHub Actions run for your current
  branch, with its real step count, beside the branch switcher.
- **Browse a Docker container's databases** and their tables in Docker's own
  section.
- **Verify the audit chain.** *Audit ▸ Verify chain* re-walks the hash-chained
  log and tells you whether it still holds, with the number of entries checked.
  An audit claim you cannot check is decoration, so the check now ships with it.
- **Commercial licensing.** AirLock is dual-licensed: the PolyForm Strict grant
  is unchanged for noncommercial use, and commercial use now has a licence to
  buy. See [COMMERCIAL.md](COMMERCIAL.md).

### Changed
- **One loading state everywhere.** Every panel and page that fetches now shows
  the same spinner instead of nine different spellings of "loading…" — and,
  more importantly, stops rendering an *empty result* as though it were the
  answer. Several surfaces used to paint a finished-looking empty page for
  seconds while a CLI probe ran, which read as the app being frozen.
- **The Activity panel is gone.** It held a permanent rail slot and was empty
  most of the time; two of its sources duplicated Render's and Docker's own
  sections, and a third could no longer fire at all. Its one unique capability,
  CI, moved into Git. The `activity_status` MCP tool became `ci_status` and
  `dismiss_activity` was removed, taking the tool surface from 37 to 36.
- **GitHub account rows are a toggle.** Clicking the account a project is
  already pinned to now unpins it. The pin installs a per-repo git credential
  helper, so being stuck pinned was a real state, not a cosmetic one.
- **Connected extensions have an "Open" button** back — Slack and GitHub could
  not be reached from their own hub pane.
- **Databases and Host always state a reason.** Every provider row is present
  whether or not it is connected, and says why it is empty — "not installed",
  "no database containers", "3 services" — rather than showing a blank.
- **README:** the security caveats now sit next to the claims they qualify
  rather than 900 words later in the FAQ, the no-secret-value invariant links to
  the test that enforces it, and the comparison table includes the rows AirLock
  loses. The tool count is test-enforced, so it cannot drift again.

### Fixed
- **Azure and Snowflake no longer leak other projects' resources.** `az webapp
  list` and `snow SHOW WAREHOUSES` are account-wide, so a project that does not
  use Azure was shown every web app in the subscription. Their sections and the
  Host/Databases rows are now project-scoped — and the CLIs are not spawned at
  all in a project that does not use them.
- **A stale Slack channel allow-list** could survive a re-bind to a different
  workspace, where the channel ids mean nothing. Now cleared, matching what the
  connect path always did.
- **"Use Airlock" asks which channels.** Reusing a pooled workspace used to bind
  and stop, leaving the project connected with nothing allowed. It now opens the
  channel picker, and when the saved sign-in can only read public channels it
  offers to re-authorize with private access instead of silently showing less.
- Various quota-meter and MCP fixes.

## 0.6.0

Released without notes at the time; written up retroactively from the commit
history, so it is thematic rather than exhaustive.

### Added
- **Project-tab tear-off.** Drag a project tab out of the window to detach it
  into its own window, or drop it onto another AirLock window to merge it in —
  with its terminals still running. A live `claude` keeps streaming, scrollback
  intact.
- **Plan usage in the title bar.** Two gauges flanking the window title (your
  5-hour and 7-day windows, colour-shifting as they fill) that click through to
  a per-session usage dashboard: API time, cost as a pay-as-you-go equivalent,
  lines changed, context size, and a table of AirLock's own process memory —
  which explains why the app's footprint looks large (it sums every `claude`
  session and language server it hosts).
- **A dock activity badge.** The dock icon shows whether Claude is working or
  done, driven by Claude Code hooks plus a per-session heartbeat, so it stays
  accurate through long thinking and subagent waits. Default on, opt-out in
  Settings ▸ Claude.
- **Project Changelog.** A per-project journal Claude writes as it works —
  entries with optional markdown detail, plus a Notes tab you can edit by hand,
  both searchable. Backed by `add_changelog_entries` / `update_changelog_notes`.
- **VS Code-grade editor.** Dark+/Light+ theming, a minimap, indent guides,
  bracket-pair colouring, a path-and-symbol breadcrumb, sticky scroll for the
  enclosing scope, and an explicit font size with pinch and ⌘+/−/0 zoom.
- **GitHub account per project.** Pin a project to one of the accounts `gh`
  knows, and every push from that repo uses it — terminal, agent or GUI —
  regardless of which account is globally active, because pinning installs a
  local git credential helper. Non-pinned projects auto-switch on focus.
- **Slack workspace targeting** in the connect flow, and a connected-account
  label on hub rows.
- **Start the dev server from the Host panel** in more states, including a
  detected-but-unmanaged server, and let the agent start it with a guessed
  command when none is configured.
- **⌘-click a URL in a terminal** to open it in your browser.

### Changed
- The window chrome was reworked: a folder-card title, a two-level roof for the
  focused project, animated tab reflow, and the three top-right buttons removed.
- Extension "pin" became an eye — show or hide an integration in the sidebar.
- The Update button in the status bar was upgraded, and dev builds can now be
  applied through it (`npm run package:dev`), which is how AirLock updates
  itself during development.

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
