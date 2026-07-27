# AirLock

Terminal-first AI IDE (Electron + TypeScript monorepo). Two workspaces:
`packages/agent-core` (pure, electron-free logic) and `packages/app` (Electron
main + preload + React renderer).

**Commands** (repo root): `npm test` (vitest), `npm run typecheck`, `npm run lint`
(biome), `npm run dev` (electron-vite dev window), `npm run package`
(electron-builder → `packages/app/release/mac-arm64/AirLock.app`), `npm run
dist:mac` (shareable DMG → `packages/app/release/AirLock-<version>-arm64.dmg`,
ad-hoc signed — recipients use the Gatekeeper "Open Anyway" bypass).

**Release naming (must match exactly):** tag `v<version>`, release title
`AirLock v<version>` — e.g. version `0.6.0` → tag `v0.6.0`, title
`AirLock v0.6.0`. Releases are cut by hand (`gh release create`, no workflow), so
two titles had drifted to `AirLock 0.5.0`/`AirLock 0.3.0` and were renamed
2026-07-25. Keep the `v` in BOTH. The in-app updater reads `tag_name` (stripping a
leading `v`) and never the title, so the tag format is the functional one — but
bump `package.json` **and** `packages/app/package.json` together, since the DMG
name and the update version compare come from them. Publishing needs
`gh auth switch -u RicardoRamosT`.

**Testing convention:** unit-test pure modules; keep electron/chokidar wiring
thin and untested (e.g. `fsWatch.ts` only tests its pure helper).

**Renderer ↔ agent-core boundary:** the React renderer must NEVER *value*-import
`@airlock/agent-core`. Its index barrel re-exports native deps (e.g.
`@napi-rs/keyring` via `broker/keychain`), so `electron-vite` tries to bundle a
`.node` binary into the browser build and fails
(`UNLOADABLE_DEPENDENCY: stream did not contain valid UTF-8`). `import type` is
fine (erased at build). For renderer-facing *runtime* data, put it in
`packages/app/src/shared/ipc.ts` (no native deps) or pass it over IPC — e.g.
`TERMINAL_DISPLAY_NAMES` mirrors agent-core's registry there. **`npm test` and
`npm run typecheck` do NOT catch this — only `npm run package` does**, so
repackage after any change that adds a renderer import.

## Claude usage quota meter

A sidebar-pinned, **account-wide** meter showing Claude subscription usage
(5-hour and 7-day windows: % used + reset countdown), bottom-left of the
project sidebar. Default **ON** (`AppPrefs.quotaMeter.enabled`); toggle in the
Settings tab's "Claude" section.

**Data source.** The only place Claude Code exposes `rate_limits` is its
**statusLine command's stdin JSON** (`rate_limits.five_hour|seven_day` →
`used_percentage`, `resets_at`). No file/env/API exposes it. So AirLock
registers a statusLine that siphons the payload to a side-channel file it
watches.

**Pipeline** (all under `packages/app/src/main/quota/` unless noted):
- `resources/statusline-emit.sh` — first-party emitter Claude Code runs as the
  statusLine. **Pure POSIX shell, intentionally NOT node** (see below).
  Atomically writes the raw payload to the side-channel file, then **chains** any
  pre-existing user statusLine (re-feeds the payload, passes its stdout through).
  Reads its config (`OUT`, `PRIOR`) from a shell-sourceable file (`emit-config.sh`,
  argv[1]) written by `install.ts`.
  **Why shell, not node (diagnosed 2026-06-16):** Claude Code's statusLine spawn
  crashes ANY Node program at bootstrap on some machines — a Node
  `Utf8Value`/`MaybeStackBuffer` capacity assertion (reproduced with a trivial
  `node -e`, real node, and Electron-as-node; NOT reproducible by a normal spawn
  with matched env/cwd/argv/stdin/fds; env-sanitization via `env -i` did NOT
  help). It is not an AirLock bug — our node-based statusLine was just the victim.
  A shell statusLine sidesteps the whole class. See
  `memory/project-quota-statusline-node-crash`.
- `install.ts` — installs/uninstalls the chained statusLine in
  `~/.claude/settings.json`: idempotent, reversible, never clobbers a user
  statusLine, sets `refreshInterval`. Pure `node:fs`, unit-tested.
- `wire.ts` — path resolution + `reconcileQuotaMeter()`; **serializes** all
  reconciles (PB-H13-class write race) and skips disk writes for opt-out users
  who never installed.
- `watch.ts` — chokidar-watches the side-channel file (**polling mode**, not
  native fs.watch: a native handle goes silent across macOS sleep/wake +
  long App-Nap and never re-arms — emitter kept writing but the meter froze for
  hours until relaunch; diagnosed 2026-06-11), parses (stamps `updatedAt` from
  file **mtime** = last emit time), broadcasts `quota:changed` to all windows,
  caches latest for the `quota:get` IPC.
- `parse.ts` — pure `parseQuota` + `mergeQuota` (folds each emit onto the last
  known status so a pre-first-response emit doesn't blank the meter).
- Renderer: `lib/quotaFormat.ts` (countdown/clamp), `lib/useQuota.ts`
  (seed + subscribe), store `quota`/`quotaMeterEnabled` slice, and
  `components/QuotaMeter.tsx` placed in `Sidebar.tsx`.

**Gotchas:**
- **Account-wide, not per-project.** ANY Claude session on the machine feeds the
  one meter (the statusLine is global). It renders **once** in the window's
  single shared sidebar (activity-bar layout; the sidebar follows the focused
  pane).
- `rate_limits` only appears **after the first API response** and only for
  Pro/Max subscribers; each window can be independently absent — parse
  defensively.
- **Liveness** depends on `refreshInterval` (5s, set in `install.ts`): an open
  session re-emits on a timer so the meter stays live while idle. The UI treats
  "no emit within `STALE_AFTER_SECONDS` (15s, in `QuotaMeter.tsx`)" as **no
  active session** → shows "Start a Claude session…". Tune the two together
  (threshold must exceed refreshInterval + jitter).
- **Packaging:** the emitter (`statusline-emit.sh`) ships via electron-builder
  `extraResources`; `wire.ts` resolves `process.resourcesPath` (packaged) vs repo
  `resources/` (dev). It runs via `/bin/sh` (no `node`/`jq`/PATH assumed); the
  emitter + config paths are single-quoted.

Clicking the meter opens the **Usage dashboard** — an IDE-level page-tab in
the PROJECT strip (like Settings; both can be open at once, `appPage` selects
the shown one, rendered in the workspace panes slot): per-session/per-model
usage from a capped ledger the watcher folds on every emit
(`parseSessionUsage`/`recordUsage` in `parse.ts`, `usage:get` IPC). **Payload
semantics (Claude Code ≥ 2.1.132):** `context_window.total_*` is the CURRENT
context (occupancy from the most recent API response), NOT cumulative — never
sum it across sessions; the cumulative session metrics are the `cost` block
(`total_cost_usd`, `total_api_duration_ms`, lines). So API time leads the
comparison (subscription sessions report `total_cost_usd: 0`), and the
per-session Context column is a labeled snapshot. Also upstream: the payload
only refreshes on main-conversation activity — background subagent/workflow
usage lands when its result message arrives, so a "frozen" dashboard during a
background task is expected, not a pipeline bug. Selecting a project tab
hides the page but keeps its tab open.

Spec: `docs/superpowers/specs/2026-06-09-claude-quota-meter-design.md` ·
Plan: `docs/superpowers/plans/2026-06-09-claude-quota-meter.md`.

## Claude auto-start in terminals

App-global pref `claudeAutoStart` (`"off" | "first" | "every"`, default
`"first"`; Settings tab → Claude). New PROJECT terminals auto-run `claude`:
`first` = one per tab via an atomic claim (`TabTerminals.claudeAutoId`,
released when its terminal dies, so the next new terminal regains a session);
blank tabs are always exempt (also dodges the launch-vs-prefs-hydrate race —
project terminals only exist post-hydration). The decision is
`store.claudeAutoDecision(terminalId)` (unit-tested); `TerminalPane` injects
`CLAUDE_AUTO_COMMAND` (`"claude\n"`, same bytes as the "Start Claude here"
notice) at pty adoption. Spec:
`docs/superpowers/specs/2026-06-09-claude-auto-start-design.md`.

## Project-tab tear-off

Drag a project tab out of a window to detach it into its own window, or onto
another AirLock window to merge it in. **Running terminals move alive** — a live
`claude` keeps streaming, with its scrollback.

- Both windows are ONE process, so the drag is a normal HTML5 drag in the
  **source** window and main decides the outcome from
  `screen.getCursorScreenPoint()` (`main/tabdrag/target.ts` — pure, unit-tested).
  No native cross-window DnD, which also dodges the macOS quirk where `dragend`
  coordinates come back stale/zeroed once the pointer leaves the window.
- **PTY ownership (the load-bearing change):** `pty:create` no longer captures the
  creating window's `webContents`. Output goes to `sessionTargets.get(id)`, read
  **per chunk**, so `pty:adopt` can re-point a live session to another window.
  Adopt also updates `sessionWindows` — **an isolation boundary** (MCP terminal
  tools scope by it so a window only sees its own terminals), so it must always
  follow the stream — and returns the `ptyBuffers` tail to rehydrate scrollback.
  Tail snapshot + re-point happen in one synchronous block, so no chunk is lost or
  duplicated. Adopt is admitted only via a single-use `MovingSessions` ticket, so
  no window can adopt an arbitrary pty by guessing an id.
- **Ordering:** the renderer builds the payload, main performs the move, and only
  then does the source drop the tab (add before remove) — so a failed move cannot
  lose a tab, and an in-window reorder is a true no-op. `TerminalPane` skips
  `ptyKill` for ids in `movingPtyIds` (otherwise tearing off would kill the very
  session being preserved) and **consumes** the marker via `forgetMovingPty`, or a
  later legitimate close of that pty would also skip its kill and orphan a shell.
- Not movable: split pairs (one tab, two projects), the Settings/Usage page-tabs,
  and a window's last tab (already its own window).
- Session restore does NOT rebuild the window arrangement — `SessionSnapshot`
  holds roots only, with no window grouping.

Spec: `docs/superpowers/specs/2026-07-25-tab-tear-off-design.md` ·
Plan: `docs/superpowers/plans/2026-07-25-tab-tear-off.md`.

## Sidebar layout system

All left-sidebar section panels share one layout grammar so a new section looks
like the rest instead of drifting into ad-hoc styles. Defined in `theme.css`;
**use these, don't reinvent per section.**

- **Tokens:** `--control-h` (24px — every interactive control: `.btn`, `select`,
  `input`, `.sb-control`), `--sb-gap` (6px, between controls in a row),
  `--sb-row-gap` (2px, between list rows), `--sb-block-gap` (10px, between stacked
  blocks). List/tree rows keep `--row-h` (22px).
- **Classes:** `.section-toolbar` (a row of action buttons; its `.btn` children
  stretch equal-width — use it for every refresh / connect / add / set row,
  including a lone full-width connect button), `.row-action` (a trailing 22×22
  icon action on a row; add `.reveal` to hide until the row is hovered — the
  reveal trigger is wired per row container, currently only `.db-entry-head` for
  Databases' remove), `.sb-control` (a `select`/`input` sized to `--control-h`
  that fills its flex row), `.section-empty` (the empty-state note; works as a
  clickable `<button>` too), `.sb-card` (a bordered/rounded/padded callout
  container for status / empty / **connect** states — NOT list rows; its lone
  `.btn` stretches full-width, so pair it with `.btn.primary` for a prominent
  CTA), `.sb-section-head` (an uppercase sub-section header) + `.sb-badge` (a
  count pill after its label, e.g. `Connected · 3`; used by the Extension Hub
  buckets).
- **Skeleton per section:** shared header (`.sidebar-view-header`) → optional
  `.section-toolbar` → body (list rows at `--sb-row-gap`, control blocks at
  `--sb-block-gap`) → optional footer. Block-style sections (e.g. Git) set their
  container `gap` to `--sb-block-gap`; list-style sections use `--sb-row-gap`.
- **Composed views:** DATABASES and HOST stack several section components
  (`LocalHostSection` + `RenderSection` + `IntegrationsSteadySection`, etc.) under
  the single view header — keep each section's primary action a full-width
  `.section-toolbar` button so the stack reads consistently, and give "authed but
  no resources" states a `.section-note` (not a bare header).

Spec: `docs/superpowers/specs/2026-06-15-sidebar-layout-standardization-design.md` ·
Plan: `docs/superpowers/plans/2026-06-15-sidebar-layout-standardization.md`.

## GitHub account per project

Two layers keep the right GitHub account in play, because the agent pushes by
running `git push` in a **terminal** (there is no MCP `git_push` tool — only
`git_commit`, which already routes through the per-project account). A terminal
push uses whatever `gh` account is **globally active**, so a wrong active account
→ GitHub 404 "repo not found".

- **Pin (the fix).** The accounts popover's "Pin to this project" writes the
  `ProjectConfig.githubAccount` override AND installs a **local, uncommitted** git
  credential helper in the repo (`buildCredentialHelperConfig` in
  `agent-core/git/auth.ts` → `applyCredentialHelper` in `main/github/account.ts`
  via `git config --local`). The helper serves the pinned account's token from
  `gh auth token --user <pinned>`, so **every** push from that repo — terminal,
  agent, or GUI — uses the pinned account regardless of the active account or
  which project is focused (background-safe). Unpin removes both. HTTPS only (SSH
  pushes by key; pin still sets commit identity via `ensureIdentityFor`).
- **Auto-switch (the convenience).** App pref `githubAutoSwitch` (default on,
  toggle in the dialog). On focusing a **non-pinned** project, `autoSwitchForFocus`
  runs `gh auth switch` to its auto-detected account (fired by
  `useGithubFocusSync` → `github:autoSwitchOnFocus`). **Pinned projects are
  skipped** (immune).
- **Accepted limitation:** a **non-pinned** project pushing in the **background**
  while a **different-account** project is focused uses the wrong account — the
  machine has one active account. Remedy: **pin it** (pinned repos are immune).
  Auto-switch resolves the common ~80%; pinning resolves the rest.

Spec: `docs/superpowers/specs/2026-07-18-github-account-per-project-design.md` ·
Plan: `docs/superpowers/plans/2026-07-18-github-account-per-project.md`.

## Slack workspace connect

Connecting Slack asks WHICH workspace first, then proves it got that one.

- **Pick by name.** The connect modal (`OAuthDeviceModal.tsx`) lists workspaces
  read from the Slack desktop app's `root-state.json`
  (`main/extensions/slackDesktop.ts` → `parseSlackWorkspaces` in
  `agent-core/src/slack/workspaces.ts`). That file holds session tokens, so the
  parser reads **only** id/name/domain/url and returns only the first three.
  Missing app / bad JSON → `[]`, which is a normal state, not an error. Slack is
  therefore the one provider that does **not** auto-open the browser on modal
  mount — choosing has to precede the approval page.
- **Paste fallback.** Browser-only workspaces never appear in the desktop app
  (observed 2026-07-26), so a URL/domain/slug/`T0…` field is mandatory, parsed by
  `parseWorkspaceInput` (which absorbed the old `normalizeTeamId`). Junk yields an
  empty target — Slack's own picker then decides, and verification still catches a
  wrong result.
- **Subdomain, not just `team=`.** `team=` on `slack.com/oauth/v2/authorize` is
  advisory: with the browser signed into another workspace, Slack authorizes
  *that* one. `buildAuthorizeUrl` swaps the host to `<domain>.slack.com` when a
  domain is known. The domain is a validated DNS label, so it can't smuggle
  characters into the host.
- **Verification is the only correctness guarantee**, and it can only run after
  the token exists. `extensions:oauthBegin`'s `capture` runs `auth.test` (whose
  parse now also yields the workspace `domain`), compares via `workspaceMismatch`,
  and the verdict rides the **first** `extensions:oauthResult` — `afterVault` is
  AWAITED for exactly that reason (bounded by the Slack client's 15s abort; a
  throw degrades to a plain success, so a good token still connects). Mismatch →
  the modal holds open with **Keep** (adopt the connected workspace as the pin) or
  **Try again**.
- **Storage:** `workspacePin` stays a plain string for back-compat; the optional
  `workspacePinDomain` / `workspacePinName` ride alongside. Pin-only configs from
  older builds keep the generic authorize host. `slackWorkspacePatch` still clears
  `channels` when the workspace id changes — allow-list ids are workspace-scoped.

Spec: `docs/superpowers/specs/2026-07-26-slack-workspace-connect-design.md` ·
Plan: `docs/superpowers/plans/2026-07-26-slack-workspace-connect.md`.

## Extensions hub

The hub is a **page**, not a sidebar section. Its rail icon (below the divider)
calls `openAppPage("extensions")` and **collapses the sidebar** — there is no
sidebar body for `"extensions"` any more, and `effectiveView` treats the id as
ineligible so an older prefs file naming it as `activeView` falls back to a real
section instead of rendering blank. Clicking the icon again re-shows the page;
closing is the page tab's own X (discarding a page is more destructive than
hiding a panel). The id STAYS in `BUILTIN_SECTIONS` / `BUILTIN_SECTION_META` so
the icon, right-click → Hide, and the View menu keep working.

**Which buttons a row offers is DATA, not JSX.** `extensionActions(summary)`
(`agent-core/src/integrations/actions.ts`, pure + unit-tested) returns the
ordered `ExtensionAction[]`; `extensions:list` attaches it to every summary
main-side — both the manifest-derived rows and the Tier-2 connected ones —
because the renderer may not value-import agent-core. A surface renders the list
and performs the action; it never re-derives which actions apply. This replaced
~90 lines of nested ternaries in the deleted `ExtensionsSection`.

**`ExtensionResources` lives in its own file** (`components/ExtensionResources.tsx`),
extracted verbatim before the sidebar hub was deleted — it used to be defined
*inside* `ExtensionsSection.tsx`, so deleting that file would have taken the only
resource-list implementation with it. Both the page's detail pane and (until its
removal) the panel imported it, gated on the same `expandable` condition.

Spec: `docs/superpowers/specs/2026-07-27-extensions-reorganization-design.md` ·
Plan: `docs/superpowers/plans/2026-07-27-extensions-hub-page.md`.

## What counts as an extension

**Core is what AirLock authored over your own machine; an extension is an
adapter over a third-party product you separately PROVISION.** The operative
word is provisioning, not authorship: Git is third-party software AirLock wraps,
but there is no account and no connect step, so it is ambient and stays core.
Docker is a product you installed, which may not be there. Applying that rule
refiled six services — Neon, Docker, Render, Snowflake, Azure, Vercel — that had
been sitting in built-in sections. (Render was missed on the first pass and
caught by applying the rule mechanically; that is the argument for having one.)

Three kinds of extension coexist, and the differences are real:

- **section** (`integrations/sectionExtensions.ts`, `tier: "section"`) — owns a
  rail area and brings its own code. This is the GENERAL shape.
- **connected** (`CONNECTED_EXTENSIONS`, `tier: "connected"`) — OAuth with a
  per-project vaulted token: Slack, GitHub.
- **status** (`INTEGRATIONS` manifests, `tier: "status"`) — a declarative CLI
  poll. The LIMITED case: it cannot express a connect flow, which is why
  Snowflake and Azure will eventually graduate off it.

**Rail policy: extension icons are always shown, enabled or not** — a user
cannot enable what they cannot see. The rail scrolls, and right-click → Hide is
the escape valve. This overrides manifest `relevance` gating for the ICON only.
Order below the divider is hub → connected → section, each alphabetical by name,
so an icon sits in the same place in every project (`composeSectionMeta`). Note
this differs from `providersFor`'s registry order, which drives a different
surface — they are deliberately not unified.

**Databases and Host are ROUTERS, not inventories.** Both render the shared
`ProviderRows`, and the two sections are one pattern rather than two special
cases. Its three rules:

1. **The provider row is ALWAYS present** and always states a reason — "not
   installed", "no database containers", "3 services". Never a bare blank and
   never `Nothing to show yet.`: a correct empty answer that does not say WHY is
   the failure this replaced.
2. **Two levels of connect, never conflated.** Connecting the EXTENSION (is
   Docker running) is not connecting an INSTANCE (open a Postgres session).
3. **Every row links onward** via `→`. Databases shows what you can query, Host
   shows what is running; the full inventory lives in the extension's own area.

The only difference between the two is the verb on an instance: Databases
**Connect** (a Postgres session), Host **Open** (the service URL).

Only Postgres is connectable — the client is `pg` via `withDb`/`readRows` — so a
Docker instance needs `engine === "postgres"` AND a published `hostPort` (null
means it is reachable only inside the docker network, and a Connect that cannot
work is worse than none). Snowflake is not Postgres, so its row is redirect-only
with no Connect button at all.

Spec: `docs/superpowers/specs/2026-07-27-extensions-reorganization-design.md` ·
Plans: `docs/superpowers/plans/2026-07-27-extensions-hub-page.md`,
`docs/superpowers/plans/2026-07-27-extensions-reclassification.md`.
