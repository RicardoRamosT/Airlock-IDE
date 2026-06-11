# AirLock

Terminal-first AI IDE (Electron + TypeScript monorepo). Two workspaces:
`packages/agent-core` (pure, electron-free logic) and `packages/app` (Electron
main + preload + React renderer).

**Commands** (repo root): `npm test` (vitest), `npm run typecheck`, `npm run lint`
(biome), `npm run dev` (electron-vite dev window), `npm run package`
(electron-builder → `packages/app/release/mac-arm64/AirLock.app`).

**Testing convention:** unit-test pure modules; keep electron/chokidar wiring
thin and untested (e.g. `fsWatch.ts` only tests its pure helper).

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
- `resources/statusline-emit.cjs` — first-party emitter Claude Code runs as the
  statusLine. Atomically writes the raw payload to the side-channel file, then
  **chains** any pre-existing user statusLine (re-feeds stdin, passes its stdout
  through) in a cleaned env (strips `ELECTRON_RUN_AS_NODE`) with a spawn timeout.
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
- **Packaging:** the emitter ships via electron-builder `extraResources`;
  `wire.ts` resolves `process.resourcesPath` (packaged) vs repo `resources/`
  (dev). It runs via `ELECTRON_RUN_AS_NODE` on the app's own Electron binary
  (no `node`/`jq` on PATH assumed); shell paths are single-quoted.

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
