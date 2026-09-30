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
bump **all three** `package.json` files together — root, `packages/app` and
`packages/agent-core`. The DMG name and the update version compare come from the
first two; agent-core was silently left at 0.6.0 through the 0.6.1 prep and is a
trap for whoever reads it next. `npm install --package-lock-only` then syncs the
lockfile, which also carries all three. Publishing needs
`gh auth switch -u RicardoRamosT`.

**Release checklist** (0.6.1 onward): changelog entry → bump the three
package.json + lockfile → `npm run dist:mac` → `shasum -a 256` the DMG and put
the digest **in the release notes** (added 0.6.1; its absence was glaring for a
product whose pitch is trust) → tag + release → `git push origin main` and the
tag. Notarization is NOT yet configured (`identity: "-"` is ad-hoc), so the notes
must keep telling users about the Gatekeeper "Open Anyway" step until it is.

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

## Loading states: one primitive, three states

`components/Loading.tsx` is the app's ONE loading state (added 0.6.1, replacing
nine spellings of "loading…" across 24 sites). Two rules matter more than the
component:

- **Three states, not two.** A fetching surface's initial state is `null` = NOT
  ASKED YET, distinct from `[]` = asked, and the answer is none. Conflating them
  is what made several panels paint a finished-looking EMPTY page for seconds
  while an 8s CLI probe ran — reported as the app being "frozen", though nothing
  ever blocked.
- **First load only, and all-or-nothing.** These surfaces poll (5s typically);
  a refresh must never return state to `null` or the spinner flashes forever. And
  a surface with several first-paint fetches waits for ALL of them, then renders
  once. Only fetches the first paint needs participate — lazily-expanded data
  never gates.

`Loading` delays ~150ms before appearing (a spinner that flashes for 80ms reads
as a glitch) and keeps its element under `prefers-reduced-motion`, stopping only
the animation. Empty states were deliberately NOT changed: they were correct, just
shown at the wrong time.

## Extension relevance, and the per-project opt-in

An account-wide CLI (`az webapp list`, `snow SHOW WAREHOUSES`) returns the whole
subscription, so a manifest may declare `relevance` (a vaulted `AZURE_*` secret,
or an `azure.yaml` in root) to limit itself to projects that use it.

- **The gate is opt-in PER CALL SITE**, not on the handler:
  `integrations:resources(id, scoped?)`. The three project-scoped callers pass
  `true` (the rail section + the Host/Databases provider rows); the Extension Hub
  omits it and stays account-wide on purpose. The gate used to live only in
  `integrations:steady`, which lost its renderer callers when Databases/Host moved
  to ProviderRows — so nothing enforced it and ElArqui listed LendLogic's web apps.
- **`relevant = the user said so, OR a signal matches.`** The signal is a
  heuristic, so `ProjectConfig.extensions.<id>.useHere` overrides it (the "Use it
  here" button + the hub's per-project switch). Checked FIRST in `isRelevant`.
  There is deliberately no opt-OUT.
- `SteadyIntegration.status` gains `"irrelevant"` as `DetectStatus | "irrelevant"`,
  NOT inside DetectStatus — no CLI ran to produce it, and keeping it out makes it
  structurally impossible for the account-wide Hub union to receive it.
- **`patchProjectExtension`** (agent-core) is the ONLY safe way to write one
  extension's per-project config: `writeProjectConfig` shallow-merges, so writing
  the `extensions` map by hand replaces it wholesale. It does the read-modify-write
  INSIDE the per-root write chain. Both former hand-rolled callers are moved onto
  it; do not add a third.

Audit: `verifyAuditChain` now has a user-facing entry point — **Audit ▸ Verify
chain** (`audit:verify`). An audit claim nobody can check is decoration.

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
- Not movable at all: split pairs (one tab, two projects) and the Settings/Usage
  page-tabs — the renderer sends main a null payload for those.
- **A window's LAST tab is a different case, and conflating the two was a bug.**
  It cannot DETACH (its window is already that project's own window) but it can
  MERGE, which is the only way to put a torn-off window back. The renderer used
  to withhold its payload for both, so a torn-off window was unmergeable: the
  target window painted "Drop to add X here" and the release moved nothing. The
  two are now told apart by `canDetach` (false = last tab), which rides both
  `tabdrag:start` and `tabdrag:end`; `dropAction` (pure, in `target.ts`) turns it
  into none/merge/detach, and `hoverTarget` keeps the in-flight hint from
  offering a new window the release would not open. A merge that empties its
  window CLOSES it (`window:close`), gated on the move having actually happened —
  never on "one tab left", since a tab can stop being the window's between the
  release and main's reply. An open Settings/Usage page-tab keeps the window.
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
- **A pin is re-asserted on focus, because a pin ROTS.** `.airlock/config.json`
  saying a project is pinned is not proof the pin is in force. `gh auth
  setup-git` — which an agent reaches for the moment a push 404s — replaces our
  per-account helper with the account-agnostic `gh auth git-credential`, which
  serves whatever account is globally ACTIVE; and pins written before 2026-07-20
  never got a helper at all. Both fail SILENTLY: the UI still shows "pinned"
  while pushes go out as the wrong user, the agent "fixes" it with
  `gh auth switch`, and every other project's push breaks in turn. That is the
  account-thrashing loop, and it was live across three repos until 2026-08-20.
  `ensurePinnedHelper` (called from `github:autoSwitchOnFocus`) diffs the repo's
  local helper against the pin via `credentialHelperIntact` (pure, unit-tested)
  and reinstalls when they disagree. The predicate rejects TWO shapes, not one:
  a missing/foreign scoped helper, AND a foreign helper in the unscoped
  `credential.helper` list — git runs that list in order and stops at the first
  helper that answers, so a generic one sitting after our reset wins even though
  our correct scoped helper is still present.
- **Pinned projects never move the global account.** `autoSwitchTarget` (pure,
  in `git/resolve.ts`) returns null for `source === "override"`. Pinning used to
  force `gh auth switch` on focus so the accounts dialog looked coherent; that
  made the one global account follow whichever tab you last clicked — breaking
  background pushes from every other project — and it propped up clobbered pins,
  hiding the real defect behind what merely looked like churn.
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
section instead of rendering blank. **The icon TOGGLES**, like every other icon
in the rail: a second click closes the page and gives the sidebar back — but
only if the hub is what collapsed it (`hubHidSidebar`), so someone already
working without a sidebar does not get one forced on them. It used to re-open
the already-open page instead, on the theory that discarding a page tab is more
destructive than hiding a panel; in practice that made the second click do
nothing visible EXCEPT take the sidebar away, leaving neither a panel nor an
obvious way back. The id STAYS in `BUILTIN_SECTIONS` / `BUILTIN_SECTION_META` so
the icon, right-click → Hide, and the View menu keep working.

**Which buttons a row offers is DATA, not JSX.** `extensionActions(summary)`
(`agent-core/src/integrations/actions.ts`, pure + unit-tested) returns the
ordered `ExtensionAction[]`; `extensions:list` attaches it to every summary
main-side — both the manifest-derived rows and the Tier-2 connected ones —
because the renderer may not value-import agent-core. A surface renders the list
and performs the action; it never re-derives which actions apply. This replaced
~90 lines of nested ternaries in the deleted `ExtensionsSection`. **Performing**
an action is the other half, in `renderer/lib/extensionActions.ts` — shared by
the hub button and by Claude, so the two paths cannot drift.

**Hub buckets are the CONNECTION STATE, nothing else:** Connected / Not
connected / Not installed / Disabled. There used to be a fifth, "Has its own
section", which answered a question nobody asks — every extension has one. It
existed only because `sectionExtensionSummaries` hardcoded `status: "ready"`
(the pure registry cannot see liveness), which would otherwise have filed an
uninstalled Docker under Connected. Main now probes the three for real
(`sectionExtensionStatuses` in `ide-state.ts`, reusing the docker/neon/render
probes that already backed their IPCs) and passes them in, so **no hub surface
special-cases `tier === "section"` any more.** Docker is the one that can be
installed-but-unusable (daemon down) → `unauthed`, distinct from `absent`; the
"Installed, not signed in." wording is reserved for Tier-1 CLI manifests, the
only extensions with a real install-then-login two-step.

**Every row links onward**, the same rule Databases/Host follow. Neon and Render
connect by pasting an API key into their OWN section and declare no CLI connect
command, so `extensionActions` gave them nothing — an accurate "Not connected."
and no way to act on it. Any row with `hasSection` now gets an `openSection`
action, appended LAST so a real connect action stays the primary button.

**There is NO "Show in {category}" switch, and there must not be.** It wrote
the `pinned` pref, whose only readers — `integrations:steady` and
`extensions:resources` (via `eyeOnConnected`/`pinnedEnabledManifests`) — lost
their renderer callers when Databases and Host were rewritten to always-present
`ProviderRows`. So it silently controlled nothing (found 2026-07-27: Render and
Azure showed in Host with the switch off). It cannot be repaired by re-wiring
either, because router rule 1 is that a provider row is ALWAYS present and
always states a reason — a switch that hid one would contradict the design.
**That plumbing is now dead and should be removed**: `integrations:steady`,
`extensions:resources`, `useExtensionResources`, `eyeOnConnected`,
`pinnedEnabledManifests`, and the `pinned` field itself.

**Identity is reusable; infrastructure is not.** A Slack workspace and a GitHub
account are WHO YOU ARE — reused across projects, so re-authorizing per project
is pure friction. A database or a hosting service is WHAT THIS PROJECT RUNS ON
— rarely shared, and a one-click "reuse" there invites binding project B to
project A's production database. So Slack has a workspace POOL
(`main/slack/accounts.ts`, mirroring the Neon key pool: non-secret enumerable
registry + one keychain entry per workspace + a per-project binding in
`ProjectConfig.extensions.slack.workspace.id`, the VERIFIED team id — never
`workspacePin`, which is only what the user *requested*) and GitHub surfaces
`gh`'s accounts; Neon, Render, Snowflake, Azure and Docker deliberately do NOT.
**Nothing ever auto-binds** — unlike Neon's sole-account default, an unbound
project is not connected however many workspaces are pooled, because the click
is what keeps projects isolated. Slack's `disconnect` clears the BINDING only;
removing a workspace from the pool is a separate, louder action that
disconnects every project using it. Legacy per-project tokens fold into the
pool lazily on first read (a startup sweep would read a keychain entry per
known project), writing the pooled copy and reading it back BEFORE deleting the
old one.

**The detail pane is SIX FIXED SLOTS** — header, status, actions, settings,
resources, danger — and a slot is never omitted, only filled differently. The
button rule is `splitActions` (pure, exported, unit-tested): the destructive
action goes to a ruled footer, the first remaining action is `.btn.primary`,
the rest are secondary. It selects by the `danger` FLAG, not the `disconnect`
kind, so a future destructive action is fenced off without editing the rule.
Resources is the slot whose conditions overlap — evaluate **in order**: inline
list → not connected → owns a section → none. Neon is both `hasSection` and
not connected and must get the not-connected answer, since pointing at a
section that currently lists nothing is true and useless. Before this, every
action was `.btn.primary` (so `Open Azure` shouted as loudly as
`Connect Snowflake`) and Docker/Neon/Render rendered no Resources slot at all.

**`ExtensionResources` lives in its own file** (`components/ExtensionResources.tsx`),
extracted verbatim before the sidebar hub was deleted — it used to be defined
*inside* `ExtensionsSection.tsx`, so deleting that file would have taken the only
resource-list implementation with it. Both the page's detail pane and (until its
removal) the panel imported it, gated on the same `expandable` condition.

**Claude can drive a connect flow, and can never finish one.**
`extension_status(id?)` returns the hub inventory (and, with an id, that
extension's resources); `extension_connect(id)` starts the flow via the shared
dispatcher. Two invariants, both unit-tested: it **cannot disconnect** —
`primaryConnectAction` only ever selects a connecting action, so a connected
Slack answers "already connected" instead of picking the destructive action
sitting next to it — and it **never handles a credential**. The browser
approval, the pasted key and the CLI prompt stay with the user, and no token is
ever a tool argument (that would put it in the transcript). It returns the step
the USER must complete, so Claude never reports a connection that has not
happened.

Spec: `docs/superpowers/specs/2026-07-27-extensions-reorganization-design.md` ·
Plan: `docs/superpowers/plans/2026-07-27-extensions-hub-page.md`.

## MCP tool surface

**37 tools** (`main/mcp/tools.ts`, locked by an allowlist test that also asserts
the count and parity across ALL THREE of `resources/mcp-docs/tools.md`, the
**README**, and this file (the first two added 0.6.1: the README had drifted to
39 for a 36-tool surface, and an outside reviewer assessed the project on that
stale figure; this file joined the same test after it independently drifted to
36 — sitting inside the very section warning about the README's drift, caught
only by review, not by the test) — update all four together). Two rules
learned from trimming it:

- **Count is not the diagnostic; ambiguity is.** Tools hurt when the model must
  guess between two of them, not when there are many. `open_tab` /
  `open_app_page` / `open_terminal` / `split_view` share a prefix but have
  precise, distinct descriptions — merging them would need a
  discriminated-union schema, which degrades tool selection rather than helping.
  Left alone deliberately.
- **Name the resource as an ARGUMENT when the family will grow.**
  `docker_status`/`neon_status`/`render_services` were not confusable, but one
  status tool per product does not scale past the five section extensions —
  hence `extension_status(id?)`. Likewise `add_changelog_entry` folded into
  `add_changelog_entries`, which already took 1..N.

**Every tool call is logged** (`main/mcp/toolLog.ts` decorates `registerTool`
once in `server.ts`, so a new tool is instrumented without anyone remembering)
→ `read_events` with `category: "tool"`. **Arguments are deliberately NOT
logged** — only name, outcome, duration, plus the caller's `author` when there
is one: `send_terminal_input` and `run_command` can carry a credential, and the
name alone answers the usage question. The author is provenance, not an
argument — one of a closed set of our own identifiers (`atlas` today), so it can
never carry a credential, and without it the log cannot tell a project's own
Claude from Atlas reaching in from the portfolio. Use this data before pruning
further; the earlier round had to be argued rather than measured.

**An agent answer must say WHOSE it is.** `extension_status` returns `root` (the
project the answer was computed for) and every resources payload declares a
`scope`, because these readers do not all answer the same question: Docker is
machine-global, Neon is account-wide, Render is already filtered to the
project's git remote. Unlabelled, the narrowest reading is the one assumed —
`airlock`, which has no Dockerfile at all, was handed five containers owned by
four other projects and a Neon list of eight projects none of which were its
own, as flat lists with nothing marking them foreign. That is not cosmetic: an
agent asked to debug "the database" inspects another project's Postgres and
reports confidently about the wrong system (observed 2026-09-16 — a Claude
session in `airlock` queried Trackview's DB and offered it as proof Docker
worked).

- **Docker is narrowed at the AGENT boundary, not in `dockerStatus()`.** `docker
  ps` has no notion of a project and the Docker SECTION is deliberately an
  inventory, so the machine-global reader stays as it is; `extensionResources`
  narrows. Ownership is `com.docker.compose.project{,.working_dir}`, which
  `docker ps --format '{{json .}}'` already returns in `Labels` — so attribution
  costs no extra `docker inspect`.
- **Other projects are SUMMARISED, never dropped.** `otherProjects` carries an
  owner and a COUNT. "Nothing here, and 5 containers belong to 4 other projects"
  is honest and still points somewhere; a bare `[]` reads as "nothing is running
  on this machine".
- **`containerBelongsTo` never claims what it cannot prove:** the project dir and
  anything under it, but NOT a parent (a monorepo sibling is not this project)
  and not a prefix-sharing sibling — lendlogic-baapp's containers live in a
  worktree BESIDE the project, so they report as foreign. Conservative is the
  right failure here, since they are still listed with their directory visible.
  A non-compose `docker run` container is unattributable and is grouped under a
  null owner rather than hidden.
- Parsing `Labels` is not a plain comma split: compose writes
  `project.config_files=/a.yml,/b.yml`, so a fragment with no `=` is a
  CONTINUATION of the previous value. Splitting naively swallowed the project
  labels that follow it.

**An agent ACTION must land in the CALLER's project, never the focused one.**
Every IDE-control command goes through `runAgentCommand(cmd, callerRoot)`, and
the renderer picks its tab with `resolveCommandTab` (`shared/ideScope.ts`): a
project's Claude acts only on its own tab and never takes the screen; `null` is
Atlas, portfolio-wide by design. `callerRoot` is REQUIRED because it used to
default to `null`, so the dev-server manager, which never passed it, silently got
Atlas's scope -- Trackview's `start_dev_server` ran lendlogic-baapp's dev stack in
a lendlogic-baapp terminal, with that project's secrets injected (2026-09-28).
`open_terminal` had been moved onto the boundary on 2026-09-14; `start_dev_server`
was missed because nothing enumerated it. A command that acts on a project goes
through `target()` in `useAgentCommands.ts`, and a start it cannot perform is an
ERROR, not an idle status.

**Atlas's outbound words are SIGNED, and main signs them** (`main/agentAuthor.ts`).
Atlas can type into a terminal where a Claude session is running, it writes in the
user's imperative register, and what arrives there is indistinguishable from the
user typing it — so the receiving session read a portfolio agent's inference as its
user's instruction. Four things make the stamp worth something:

- **Identity comes from the REQUEST, never the arguments.** Atlas's own MCP client
  config carries `X-Airlock-Author` (`airlockMcpConfig`, agent-core); a project's
  Claude carries none and is unsigned. A model supplies tool arguments, not
  transport headers, so Atlas can neither suppress the stamp nor forge the user's
  voice — and `authorFromHeaders` refuses any author outside the closed set rather
  than passing a claimed string through to a pty.
- **Applied at the choke point**, in `gatedTerminalInput`, right after
  `decodeTerminalEscapes` and BEFORE the preview — so the approval card shows the
  signature that will be typed, and no call site can skip it. Deliberately not
  asked for in the system prompt: a model can forget, and a signature the sender
  controls is worth nothing to the reader. Same rule as `renderStillOpen`.
- **Submit is a SEPARATE keystroke.** A running Claude reads with bracketed
  paste, so a carriage return arriving in the same chunk as the text is a line
  break in its composer, not Enter — the message is typed and never sent. The
  send therefore writes the body, waits `SUBMIT_DELAY_MS` (120ms, the same
  number as the renderer's `OVERVIEW_SUBMIT_DELAY_MS`), then writes `\r` on its
  own. This bit twice on 2026-08-31: first as a literal `\n`, then again after
  converting the trailing `\n` to `\r`, which changed nothing because the
  character was never the problem. It reaches a SHELL either way, since a line
  discipline submits on CR however it arrives — which is exactly what made the
  first fix look verified.
- **A dispatch is a sentence; an answer is a token.** Only a submitted payload of
  ≥ `SIGN_MIN_WORDS` (5) words is signed. Appending anything to `y` or to Ctrl-C is
  corruption, not attribution, and words beat characters because a file path sails
  past any character floor. The signature also goes INSIDE the last line, before
  the submit: after it, a Claude session would receive the signature as a prompt of
  its own and answer it.
- **The signature is a `:` null command PREFIXING the last line**, so a signed
  payload that lands in a SHELL rather than a Claude session runs a no-op and
  then the real command. It was a `#` comment until 2026-08-31 on the theory
  that a comment is inert — but **zsh leaves `INTERACTIVE_COMMENTS` off by
  default** (`zsh -f -i` confirms it), and zsh is macOS's shell, so every signed
  command died with `zsh: parse error near '#'` and Atlas could not run anything
  at a prompt. It PREFIXES rather than trails because `; :` is a parse error
  after a payload ending in `&`. Single-quoted, and **the wording must stay
  apostrophe-free** so the quoting cannot be broken. `agentAuthor.test.ts` now
  proves inertness by running `zsh -f` and `bash --norc` rather than asserting
  it — the previous test asserted `startsWith("#")` and called that inert, which
  is exactly how this shipped.

Atlas's system prompt is told the stamp exists (so it writes as one agent
reporting to another rather than adding its own), but is never relied on for it.

## Secrets the agent fetches itself

Three ways a value reaches a command, and they are not interchangeable:

- **`.env` -> vault** (`import_env`), then `run_command(injectSecrets)`. Vaulted
  secrets are ALSO injected into every terminal by `injectInto` (`pty:create`),
  which is why the dev server already has them.
- **User types it** (`request_secret`) — a secure modal; the value goes
  user -> keychain and the tool resolves only a boolean.
- **A CLI fetches it** (`capture_secret`) — stdout goes into an in-memory,
  per-root **session** store (`broker/session.ts`), never the keychain. This
  exists because the alternative was the agent asking the user to run
  `az containerapp show ...` by hand, which put a live prod credential in the
  transcript (observed 2026-07-29).

**Session-scoped is a security property, not laziness.** A captured value must
never become a vault entry, because `injectInto` would then feed a prod
credential to every terminal in the project. Consequence: it dies on quit and
the agent re-fetches. `run_command` computes the session value first, but the
vault's value overwrites it on a name collision, so a user-managed secret
always wins. A name already in the vault is REFUSED (v1) rather than
overwritten.

## Agent request surface

**Agent-initiated prompts go to the CORNER; user-initiated dialogs stay MODAL.**
If you clicked "Connect Neon" you asked for a dialog. If Claude interrupts you it
should not seize the window, so `request_secret` and `send_terminal_input`'s
grant render as non-blocking cards bottom-right: no backdrop, no autofocus, no
global Escape capture, `aria-live="polite"`. `add-secret` / `update` /
`connect-*` are untouched.

**Main OWNS the registry; the renderer renders a projection.** This is
load-bearing, not a preference. If the list lived in renderer state, a window
close, a renderer reload or a project tear-off would destroy it while the agent
kept waiting. Main already held the promises (`main/agent-requests.ts`); it now
holds the list too and pushes each window its OWN slice, so no window id crosses
the boundary. The renderer takes a snapshot on mount (`agent:requests-list`) and
subscribes (`agent:requests-changed`) — the snapshot is the half that survives a
reload.

**Per-kind behaviour is DATA** (`shared/agentRequests.ts`, pure + unit-tested),
the same rule `extensionActions` follows. `AGENT_REQUEST_POLICY` declares
`actionableAfterExpiry` / `pruneOn` / `dismissible` / `resolvesExternally` per
kind; adding a kind is one row plus a card renderer, and no surface re-derives
it. The spec also named a `captureOverwrite` kind — deliberately absent, because
`capture_secret` v1 refuses an already-vaulted name instead of prompting, so it
would have no producer.

**The expiry asymmetry must not be collapsed.** An expired **secret** request
stays actionable: vaulting it is still useful and the agent finds it next
attempt. An expired **terminal grant** does not: the send already returned
`timedOut`, so approving later authorises nothing — it is pruned. Treating both
alike would either strand a useful action or offer a button that does nothing.

**Other invariants worth not breaking:**
- **Never auto-dismiss.** A toast fades; a pending request must not, or the agent
  waits on something the user never saw. Expiry changes the card's state
  *visibly* instead of removing it.
- **Dismiss means LATER.** It moves the card to the titlebar bell and does NOT
  resolve the agent. The bell sits outside `TitleQuota`'s centering group so the
  title stays centred with the meter on or off.
- **The registry cap never evicts a PENDING entry** — that would strand an agent.
  Eviction takes oldest-non-pending first.
- **Requests coalesce** by (root, name) for secrets, so two sessions asking for
  the same secret share one card and both resolve. Grants are keyed by ptyId and
  never coalesce.
- **Vaulting for an agent NEVER restarts a terminal.** `useVaultSecret().save`
  takes a REQUIRED `restartTerminal`: `SecretModal` (you clicked Add) passes
  `true`, the agent card `false`. With injection on, the shared save used to
  replace the ACTIVE terminal — which is nearly always the one running the Claude
  that asked, so answering `request_secret` killed that session and its
  subagents mid-turn (2026-09-30). The agent gains nothing from a restart: it
  reads vaulted values at call time via `run_command(injectSecrets)`.
- `window.ts` **lazy-requires** `agent-requests` because `agent-requests` imports
  `windowForRoot` from it; a top-level import would be a cycle.
- Untrusted payloads are normalised in `useAgentRequests` — the stack renders
  inside the App tree, so a throw during render whites out the whole window.

## Long-running local apps

Containers and dev servers left running cost memory and battery for days. Four
apps on the dev machine had been up ~6 days each (2026-09-21) and nothing said
so. AirLock now reports anything over `longRunningApps.thresholdHours`
(default 24, app-global, Settings > Local apps, default ON) in the
**notification bell**, with a Stop button. **It never stops anything itself.**

- **MACHINE-WIDE detection, per-project ROUTING.** Every offender belonged to a
  project other than the focused one, so a per-project monitor would have shown
  the focused project nothing -- the container-scoping bug in reverse. The scan
  is machine-wide; each notice is routed by `pickWindow(root)` to the window
  owning that app's project, which is what makes it actionable.
- **Qualify a process by its WORKING DIRECTORY, not its port.** The obvious
  filter is `COMMON_DEV_PORTS`, and it is wrong: the server that prompted this
  listens on **3005**, which is not in that list, and extending the list is
  whack-a-mole. A listening process is one of the user's apps when its cwd is
  inside a project root (`attributeToRoot`, longest match, segment-wise so
  `/p/app-old` is never claimed by `/p/app`). That also attributes it for free
  and means unrelated software never qualifies. AirLock excludes **its own
  processes** (`app.getAppMetrics()`) -- run from source its cwd IS a project
  root, so without that it reports itself.
- **Exclude AirLock's PROCESSES, never its SUBTREE.** It was the subtree, and
  every terminal is in it: a server started from an AirLock terminal -- by you,
  or by Claude's Bash tool, i.e. nearly every dev server here -- was never
  reported, and a managed server (spawned into a pty AirLock owns) never could
  be. Only a server that had detached to ppid 1 was visible, which is why the
  ElArqui case that motivated the feature passed. Found 2026-09-28 with three
  servers up 1.5-4.5 days and a silent bell, each `AirLock -> zsh -> claude ->
  npm -> vite`. `scan.test.ts` asserts the wiring, since a subtree walk
  handed to `ownPids` would type-check perfectly.
- **One card per SOCKET, not per pid listing it.** A supervisor that binds then
  forks (uvicorn `--reload`, gunicorn) shares the socket with its worker, so
  lsof lists the port under both. The OLDEST owns it -- a parent starts before
  its child -- and it is the right one to stop: SIGTERM to the reloader takes
  the worker down, SIGTERM to the worker leaves the reloader holding the port.
- **The root set is EVERY project AirLock knows** (`mergeProjectRoots`: open
  tabs + the whole Atlas registry + `recentFolders`), injected as the
  `knownRoots` dep. It was `allOpenRoots()` alone, which made `attributeToRoot`
  answer two questions at once -- "is this one of your apps" and "whose is it"
  -- so failing the second killed the first: the process path did
  `if (root === null) continue`, and a seven-day next-server on :3005 was
  dropped before its age was ever read, purely because ElArqui had no tab.
  Closing a tab silently stopped monitoring that project. (The CONTAINER path
  never had this bug -- an unattributable container reports under a null owner,
  which is why `root`/`projectName` are already nullable and `pickWindow(null)`
  already falls back to the focused window.) The whole registry, not just the
  enabled rows: "not in the debrief" is not "not my project". Widening is safe
  because every system daemon -- clamd, OneDrive, rapportd, ControlCenter --
  runs from `/`, which is nobody's project; a blank root is dropped because an
  empty string is a prefix of everything. `knownRoots.test.ts` asserts the
  wiring, since passing `allOpenRoots` would type-check perfectly.
- **Age comes from the PROCESS or the ENGINE, never from `docker ps`.** Docker's
  `RunningFor` counts from CREATED: `trackview-postgres-1`, created weeks
  earlier and restarted that week, read "4 weeks ago" against a real uptime of
  5d 20h. Containers use `.State.StartedAt` (`dockerStartedAt`); processes use
  `ps -o etime=` (locale-independent, unlike `lstart`). A container whose start
  time cannot be read is SKIPPED, not assumed old.
- **Reconciliation, not events.** Each 10-minute poll states the whole truth, so
  a notice retires when its app stops or drops under the threshold -- no prune
  trigger to wire, and nothing missed while AirLock was closed. A Stop
  reconciles immediately so the card does not linger.
- **`appIdentity` INCLUDES `startedAt`.** "Later" means acknowledge, and main
  remembers the identity so the poll never re-raises it. Without the start time
  that would silence a container forever; with it, a RESTART is a new identity
  and is reported afresh.

Two registry invariants had to generalise, because a notice is **not a request**
-- nothing awaits it (`shared/agentRequests.ts`, `main/agent-requests.ts`):

- **`KindPolicy.surface`** (`"corner" | "bell"`). `partitionRequests` routes on
  it rather than on `dismissed` alone, so an observation is born in the bell and
  can never take a corner slot from a request that is actually blocking an agent.
- **`enforceCap` evicts entries with NO WAITERS**, not entries whose state is
  not `"pending"`. The old rule existed solely to avoid STRANDING AN AGENT, and
  waiters say that directly. The two agree exactly on the request kinds (a
  pending request always has >= 1 waiter; `expire` clears them), so it is a
  generalisation -- but it is required: a notice is "pending" while its app runs,
  and under the old rule fifty of them would pin the registry at its cap and
  starve real requests while stranding nobody.

**A detected server now gets a Stop button, REVERSING the old rule** that the
unverified Host tier is "non-destructive, no pid to the renderer, no kill
button" (see `memory/project-airlock-dev-server-detection`). That was raised
with the user on 2026-09-21 and chosen deliberately: the worst offender is
always the detached one. The non-destructive half is what changed; **the pid
still never crosses to the renderer.** `localapps:stop` takes a REQUEST ID and
main resolves the pid itself (`pid` is on the main-only `LongRunningAppInput`,
deliberately absent from `LongRunningAppRequest`), so the action can only ever
target something AirLock is already reporting -- never an arbitrary process.
SIGTERM, not SIGKILL: a server asked politely exits cleanly, and one that
ignores the signal still shows up on the next poll, which is honest. A MANAGED
server is stopped through `stopDevServer` so the manager's own state follows.

**Signalling the LISTENER is enough for a supervised tree, verified 2026-09-23.**
The obvious doubt is that AirLock targets the process holding the port while
the real supervisors sit above it. ElArqui's 7-day server was
`npm run dev`(ppid 1, detached) -> `next dev` -> `next-server`(:3005) -> two
workers, and one SIGTERM to `next-server` took all five down inside the same
half-second poll: no respawn, no orphaned supervisor, port released. So do NOT
reach for a process-group kill -- a detached tree unwinds from the leaf, and
signalling the group would be a bigger hammer bought with no evidence.

Deliberately not in v1: **per-app memory** (the motivation is RAM, but
`docker stats` and per-process footprint on a timer contradict the battery goal
-- age is the actionable fact), auto-stop, and any non-dev listening port.

Spec: `docs/superpowers/specs/2026-09-21-long-running-local-apps-design.md`.

## Atlas portfolio spine

A **28px strip on the workspace's right edge**: one dot per project in the
debrief, colour only at rest. Hovering a dot shows a leader-line callout; clicking
opens the Atlas conversation as an overlay. The Atlas mark in the titlebar is
its head — it owns the same 28px column, which is why the bell sits left of it.

- **The dots are THE DEBRIEF'S PROJECTS** (Atlas's registry, `enabled && !missing`),
  NOT the open tabs. The tab bar already says what is open, so a strip
  repeating it is ambiguous rather than informative; the spine is the portfolio
  Atlas reports on. `startSpine` takes the roots as a DEPENDENCY so `spine.ts`
  stays electron-free — and because passing `allOpenRoots` instead would
  type-check perfectly, `spineRoots.test.ts` asserts the wiring. Toggling a
  project in Atlas settings calls `refreshSpineRoots()`, or the switch would
  look like it did nothing until the next tick.
- **EVERY watched project gets a dot**, including quiet ones. Fixed positions
  are the design: third from the top is always the same project, and that is
  what makes a colour-only surface readable peripherally. Hiding quiet projects
  would destroy the muscle memory the whole thing rests on. The cost is that
  most dots are grey most of the time, which is accepted.
- **At rest it is colour only** — no text, no counts, no badges. The moment it
  carries a number it stops being peripheral. Each dot's name and line ride its
  `aria-label`, because colour alone is not an accessible status.

**Clicking a dot opens THAT PROJECT's Atlas, not the portfolio's with a hint.**
All three surfaces are scoped by the one `focusRoot` prop:

- **Chat is a separate thread per project.** `turn.root` (NULL = the portfolio,
  the titlebar mark) and a per-root boundary — `chatSince:<root>`, the bare key
  still the portfolio's — so History and New chat are per project too. Every
  turn written before the column is NULL, which is correct rather than
  convenient: they were all said to the portfolio. Consequence, accepted: the
  portfolio chat cannot see what was said in a project's.
  - `root IS ?`, never `root = ?`: SQLite's `=` is never true for NULL, so the
    portfolio's turns (and every pre-migration one) would read as empty.
  - `turn.root` is in **`ADDED_COLUMNS`**, not only in `CREATE TABLE` — the
    trap `turn.session` already sprang, and `store.test.ts` reopens a
    column-less database to prove the repair.
  - **`completeTurn` takes its thread from the QUESTION's row**, not from the
    active boundary. It used to read the boundary, so a New chat mid-flight
    orphaned the pair: the answer landed in the fresh transcript with no
    question, and the question sat answerless in the old one.
  - **One resolver, `chatRoot`, validates against ATLAS'S REGISTRY** — not
    `allOpenRoots()`, which `atlas:send` used. That was right while the value
    only steered an answer and wrong the moment it also chose the thread: most
    watched projects have no tab open, so their messages would have been filed
    under the portfolio while their own transcript sat on screen. All five chat
    handlers share it, so the transcript, the send, History and New chat cannot
    disagree about which thread they are in.
- **Debrief: the project's STORED REPORT, not a slice of the prose.** The brief
  is composed ACROSS projects, so no per-project paragraph exists — extracting
  one would mean parsing prose to guess whose each sentence is. `ProjectReport`
  (did / standing / gaps) is the material that prose was written FROM, already
  per project and keyed by day (`atlas:report`, no model call). A heading
  renders only when it has lines: `[]` is a real answer, and three empty
  headings say "nothing to report" three times.
- **Still open: `concernsForRoot`** (pure, agent-core). A concern with **no
  root is PORTFOLIO-LEVEL** and appears only there — not "unattributed and
  therefore everyone's", which would assert an ownership nothing established.
  A root nothing matches is EMPTY, never everything.

**The spine CANNOT use Atlas's `CodeLedger`.** `collectLedger` is called from
exactly one place — `maybeCompose`'s `standup` dep — and `maybeCompose` is
idempotent per calendar day. `start.ts`'s 15-minute `setInterval` is a
day-rollover backstop ("a day-key comparison, and composes at most once a
day"), NOT a refresh. A dot built on that ledger would show yesterday: fix a
red CI at 10am and it stays red until tomorrow. **A colour you cannot trust is
worse than no colour**, because you learn to ignore it.

So the spine reads its own inputs, **split by cost** (`main/atlas/spine.ts`):

- **Local, 60s:** one `gitStatus` per watched root (and the tier that re-reads
  the root list). 60 and not 30 because this spawns a process PER ROOT — a
  dozen projects at 30s is 24 spawns a minute forever,
  and an uncommitted count does not need that resolution. The app ships a
  battery-saving feature; this must not be the thing that burns it.
- **Remote, a FIXED BUDGET:** `ciRunFor` + `openPrsFor` for the next
  `REMOTE_BUDGET` (2) roots per minute, round-robin (`nextSlice`, pure). It
  used to sweep every root every 5 min, so the cost was 2 gh calls per project
  per cycle — fine for five tabs, and a number that grows on its own once the
  dots follow the debrief. Now the call RATE is constant and only the time to
  come back round grows (a dozen projects ≈ 6 min, the same freshness the old
  sweep gave). Roots with no remote are filtered out BEFORE the slice, not
  skipped inside it, or they would spend the budget on nothing; a root whose
  tree has not been read yet is eligible, because unknown is not "no". The
  branch comes from the local tier (`ciRunFor(root, known)`) rather than
  `ciRunFor` spawning its own `git status` — one redundant process per root per
  cycle. `nextSlice` is unit-tested for STARVATION: a slice that never reaches
  the tail leaves the last projects permanently unread, which looks exactly
  like "nothing to report".

**Green requires positive evidence on ALL THREE inputs** (`dotState`, pure, in
agent-core). Anything unread — a failed `gh` call, no remote, a probe that has
not returned — is **quiet, never clean**. Same rule as the Docker container
scoping: never a confident answer to a question nobody asked. A *cancelled* run
is not a broken build, and a run still in flight is not a verdict either way.

**Amber is the load-bearing state, and it is PRECISE:** `mine &&
awaitingReview && !draft`. Red is the machine's problem; amber means the next
move is yours. Atlas's `PrEvent` carries no author, review decision or draft
flag, which is exactly why `main/github/openPrs.ts` exists rather than reusing
it — on `PrEvent` any open PR at all turns the dot amber, common enough to stop
meaning "act now".

- **Every `gh` call goes through `ghRunnerFor`** so the PINNED account asks. gh
  has one globally active account, so a pinned repo asked by the active one
  404s — and that 404 arrives as "nothing to report", indistinguishable from
  clean. `openPrsFor` caches your login by ACCOUNT, not by root: the pin makes
  the answer genuinely vary between projects, but most share one.
- **`ciRunFor` returns null for "no workflows" AND for a failed call**, so a
  project with no CI stays quiet forever. That is intended — quiet means
  "nothing to report", which is true. Do NOT special-case "no CI" into green.
- **The strip never changes width and the overlay never pushes.** A target that
  moves when you point at it makes you aim twice (the Update stub taught this
  the same week), and a surface that reflows the editor is one you learn not to
  open. The callout lives INSIDE its dot's slot rather than being positioned by
  index, so alignment is the browser's problem rather than arithmetic that rots
  when a padding changes.
- Rides `atlas.enabled`, **checked per tick** rather than once at startup, so
  toggling Atlas stops and resumes the polling without a relaunch. There is
  deliberately no separate spine pref.

Spec: `docs/superpowers/specs/2026-09-21-atlas-portfolio-spine-design.md` ·
Plan: `docs/superpowers/plans/2026-09-21-atlas-portfolio-spine.md`
(both gitignored — this section is the durable record).

## Atlas's project registry, and what `missing` means

The settings list IS the configuration surface, so it has to be true when you
look at it. Three rules make it so.

- **`missing` names what was OBSERVED, not what it implies.** It means the
  root did not answer a presence check. It is NOT "deleted" — one `stat`
  cannot tell a deletion from a rename, a move, an unmounted volume or a macOS
  TCC prompt you have not granted, and claiming otherwise would be a confident
  answer to a question nobody asked. That is also why a vanished root is
  FLAGGED, never dropped: removing the row would assert a deletion the check
  cannot prove.
- **Presence is THREE states** (`RootPresence`, `main/atlas/presence.ts`).
  `probeRoot` classifies `ENOENT`/`ENOTDIR` as **gone** and every other errno
  — `EACCES`, `EPERM`, `EIO`, an unmounted share — as **unknown**, and
  `applyPresenceResults` leaves an unknown root's flag AND its `lastSeenAt`
  exactly as they were. It used to be one `fs.access` with a bare
  `catch { return false }`, so "is not there" and "could not be checked" were
  the same answer — and a flagged project is silently dropped from the debrief
  (`enabled && !missing`), from the spine's dots and from the long-running-apps
  monitor. Same rule as `dotState`: an unread probe is not a negative answer.
  The probe is INJECTED everywhere (`discoverProjects`, `RefreshInput.probe`,
  `AtlasDeps.probe`) because these run against fictional paths under test, and
  reaching for the real filesystem made the whole registry read as missing.
- **Checked on EVERY read of the list**, not once a day. Discovery was live in
  one direction only: `mergeRegistry` costs nothing so a new folder appeared at
  once, but only `refreshPortfolio` could write `missing`, and its two callers
  (the morning compose, and the chat's once-a-day snapshot) meant a folder
  deleted at noon still read as fine until tomorrow. `discoverProjects` now
  probes too — one stat per project, no git, against the per-root git
  `refreshPortfolio` spends.

**`lastSeenAt` means LAST CONFIRMED PRESENT, and only the presence pass writes
it.** `mergeRegistry` used to stamp it for any rediscovered root, but appearing
in recents or an open tab is not evidence the folder exists — a recents entry
outlives the directory it names, which is the very case `missing` reports. With
merge stamping it, "last seen" read as *now* for a folder deleted weeks ago,
i.e. it was wrong at the only moment it mattered.

**Removing a row is the USER's call.** `forgetProject` was reachable only from
a debrief concern, so a dead project sat in the settings list permanently and
kept counting toward "N of M on". Missing rows now carry a **Remove** action
there too, plus a tooltip giving the path, the last sighting and the fact that
"missing" covers deleted / renamed / moved / unmounted. It is offered ONLY on a
missing row: forgetting a live project would re-seed it from recents on the
next read, so the button would appear to do nothing.

**That action is ALWAYS VISIBLE and LABELLED, and `.row-action.reveal` must
not be used for it.** It shipped once as a `reveal` trash icon —
`.row-action.reveal` is `opacity: 0` and the un-hiding rule is wired PER ROW
CONTAINER (`.db-entry-head`, `.slack-channel-head`, `.atlas-standing-row`);
`.atlas-project` has none, so the control was invisible and still perfectly
clickable, and a project was removed by someone who could not see what they
hit. opacity does not remove hit testing. A hover-reveal is for a cheap,
repeatable action; `forgetProject` cannot be undone. The word "Remove" rather
than a trash glyph also settles what it does NOT mean — nothing on disk is
touched. `revealActions.test.ts` enumerates the trigger containers from
`theme.css` and fails on any component that hides a row action without one.

## What counts as an extension

**Core is what AirLock authored over your own machine; an extension is an
adapter over a third-party product you separately PROVISION.** The operative
word is provisioning, not authorship: Git is third-party software AirLock wraps,
but there is no account and no connect step, so it is ambient and stays core.
Docker is a product you installed, which may not be there. Applying that rule
refiled the services that had been sitting in built-in sections: Neon, Docker,
Render, Snowflake and Azure. (Render was missed on the first pass and
caught by applying the rule mechanically; that is the argument for having one.)

Three kinds of extension coexist, and the differences are real:

- **section** (`integrations/sectionExtensions.ts`, `tier: "section"`) — owns a
  rail area and brings its own code. This is the GENERAL shape.
- **connected** (`CONNECTED_EXTENSIONS`, `tier: "connected"`) — OAuth with a
  per-project vaulted token: Slack, GitHub.
- **status** (`INTEGRATIONS` manifests, `tier: "status"`) — a declarative CLI
  poll. The LIMITED case: it cannot express a connect flow, which is why
  Snowflake and Azure will eventually graduate off it.

**Vercel was DELETED (2026-07-27), not merely disabled.** It was never an
integration anyone used here: the 2026-06-12 CLI-integration-framework spec
named it one of three *pilots* whose job was to "prove the engine" — the
simplest possible manifest (a JSON list command plus an auth check). It proved
it, then got carried along and eventually promoted to a rail icon in a project
that will never deploy to Vercel. Deleting it also removed the last
`surface: "activity"` manifest, so that engine branch now ships with no live
manifest exercising it — `engine.test.ts` covers it with a LOCAL fixture
(`DEPLOY`) rather than a shipped integration, which is where that coverage
belonged anyway. Of the spec's three pilots, gcloud Cloud Run never shipped and
Snowflake remains.

**Rail policy: the sidebar shows what THIS PROJECT uses.** An extension whose
signal does not fire here, and that you have not turned on here, is not on the
rail and not a row in Databases/Host. This REVERSES the old "extension icons are
always shown, enabled or not — a user cannot enable what they cannot see" rule,
which the Extensions hub now discharges: the hub is always on the rail and lists
every extension whatever its state, so the discoverability the old rule
protected no longer depends on a per-product icon. Right-click → Hide is still
the manual escape valve, and **"Use it here" (`useHere`) is the override when a
signal guesses wrong** — checked first, and there is still no opt-OUT.

There was a `railHidden` flag in between, which took the five provisioned
products off the rail WHOLESALE. It is gone. It was a blunt stand-in for
relevance, written before relevance worked — and while it was in force the
feature was invisible to the person using it, because the only rail-visible
difference left was the Slack icon. Relevance is the right instrument: the rail
gains an icon for Docker exactly when the project has a Dockerfile. Real
composition, below the divider:

    airlock          Extensions, GitHub
    Trackview        Extensions, GitHub, Docker
    Revaltone-CRM    Extensions, GitHub, Neon
    lendlogic-baapp  Extensions, GitHub, Azure, Docker
    ElArqui          Extensions, GitHub, Neon, Render

`relevant = you said so, OR a signal matches, OR it is connected here.` The
third clause is load-bearing: nothing in a repo says "this project uses Slack",
so an identity's only possible signal is being bound to the project. An empty
`relevance: {}` therefore means "gated, with no automatic signal", which is NOT
the same as no spec at all (always relevant).

**The signal is a tech id from the SHARED catalog** (`project-profile/
catalog.ts`) — the same ~80-entry detector behind the Overview and
`project_info`, reading dependencies, lockfiles, config files, manifests and
secret NAMES. `relevance: { tech: ["docker"] }`, not a list of filenames.

This replaced a per-manifest `envPrefix` + `files` pair, and the replacement is
the whole point: those were a SECOND, WEAKER DETECTOR living beside the real
one. A hand-written shortlist missed a Render project with no `render.yaml` and
a Neon project using `@neondatabase/serverless` — which is exactly what made the
feature read as hardcoded to the one person using it. **A signal the catalog
does not know belongs IN the catalog**, where the Overview and `project_info`
get it too; that is how Azure and Snowflake entries got there. The one
non-catalog signal is `gitRemoteHost` (GitHub), because the profile describes
the code, not where it is hosted.

`gather.ts` derives its probe lists from `Object.keys(CONFIG_CATALOG)` and
friends rather than re-typing them. They HAD drifted — `docker-compose.yaml`,
`compose.yml` and `azure.yaml` were in one and not the other — and a catalog
entry for a file nobody probes never fires.

**`.env` KEY NAMES are a detector input** (`DetectInputs.envFileNames`, root
`.env*` only, 64KB cap). They are what makes detection work on a project that
is not an npm app: pdfextractor is a Python service on Azure Container Apps
with no `@azure/*` dependency, no `azure.yaml`, and nothing vaulted — every
other signal missed it while a root `.env` named `AZURE_*` a dozen times.
`SECRET_CATALOG` already had the pattern; nothing fed it. Sources are labelled
`.env: NAME`, NOT `secret: NAME`, because these are not vaulted and
`project_info` reports the signal that found each tech.

**Read with `dotEnvKeys`, never `parseDotEnv`.** It stops at the `=`, so a
value is never materialised. The caller is the detector, which runs on every
`extensions:list` to decide what the sidebar shows — a UI decision has no
business holding credentials in memory, however briefly.

Snowflake and Azure declare their spec on the MANIFEST only — they are also
section descriptors, and `mergeSectionExtensions` lets the manifest row win, so
a second copy would be a second answer. (A probe that iterates the raw
registries instead of the merged rows will wrongly show them relevant
everywhere; check the merged output.)

**`relevance` was shipped once as a DEFAULTED parameter** on
`sectionExtensionSummaries`/`connectedSummary`, so neither production call site
passed it, `projectUse` was never computed, and every extension read as
relevant — the feature was inert with all tests green. Both are REQUIRED now. A
default is a new input that nothing forces you to wire, and the compiler is the
only thing that reliably enumerates call sites.

**One answer, three surfaces.** `projectUse` is computed main-side by
`projectUseOf` and ships on every `ExtensionSummary`, so the rail, the provider
rows and the hub's per-project toggle cannot disagree. The renderer reads it
through `isRelevantHere`/`keepRelevant` (`lib/extensionRelevance.ts`).
**`undefined` means NOT ASKED YET and must SHOW** — no project focused, or an
extension with no spec — and `relevantExtensions: null` in the store means the
same; filtering on either would blank Databases and Host for the first second of
every launch. `useSyncSectionMeta` re-loads on the focused root, not just on
mount and window focus, or the previous project's icons linger.

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
