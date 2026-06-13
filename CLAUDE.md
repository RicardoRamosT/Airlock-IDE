# AirLock

Terminal-first AI IDE (Electron + TypeScript monorepo). Two workspaces:
`packages/agent-core` (pure, electron-free logic) and `packages/app` (Electron
main + preload + React renderer).

**Commands** (repo root): `npm test` (vitest), `npm run typecheck`, `npm run lint`
(biome), `npm run dev` (electron-vite dev window), `npm run package`
(electron-builder → `packages/app/release/mac-arm64/AirLock.app`), `npm run
dist:mac` (shareable DMG → `packages/app/release/AirLock-<version>-arm64.dmg`,
ad-hoc signed — recipients use the Gatekeeper "Open Anyway" bypass).

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

## Docked external terminals (macOS only)

When `defaultTerminal` is external (e.g. Ghostty), AirLock doesn't reparent the
window (impossible across processes) — it **pins the real OS window onto the
terminal pane's rectangle** via macOS Accessibility (`osascript` moves/resizes
"window 1" of the app), so it *looks* embedded. No Accessibility permission →
free-floating window (the fallback). **v1 = ONE docked terminal in the single
full terminal pane;** splits / multiple-per-window / native real-time tracking
are v2.

**Pipeline** (renderer reports geometry → main drives the window):
- `agent-core/src/terminal/dock.ts` — pure: `paneScreenRect(contentBounds,
  domRect)` (window content origin + pane `getBoundingClientRect`, rounded),
  `dockVisibility(DockState)` (show only when paneShown && windowVisible &&
  !overlayActive && !dragging), `setFrameScript`/`hideWindowScript` (osascript
  builders; numeric coords + first-party process names only — no untrusted
  interpolation; "hide" = move to {-32000,-32000}). `axProcess` per terminal
  lives in `externalTerminals.ts` (the AX process name, which differs from the
  `open -a` app name for some — e.g. iTerm2).
- `main/terminal/dockController.ts` — stateful, one per `BrowserWindow`. DI'd
  `run` (osascript) + `getContentBounds` so it unit-tests without Electron.
  `apply()` computes a hide-or-setFrame script and **dedupes** against the last
  script (memoized BEFORE the await for race-safety vs the fire-and-forget
  `onDragStart`; cleared on failure so post-open retries re-run until the window
  exists). This dedupe is what keeps the renderer's per-frame resize reports
  from flooding osascript.
- `main/terminal/dockRegistry.ts` — neutral `Map<windowId, DockController>`. Its
  own module because `ipc.ts` already imports `./window`; putting the map in
  `ipc.ts` and importing it into `window.ts` would be a **circular import**.
- `main/ipc.ts` — `accessibilityTrusted(prompt)` gate
  (`systemPreferences.isTrustedAccessibilityClient`); `terminal:openExternal`
  launches then (if dockable + AX-trusted) creates/overwrites the window's
  controller; `ipcMain.on("terminal:dockRect")` (one-way) routes the renderer
  signal to it.
- `main/window.ts` — forwards minimize/restore/hide/show → `setWindowVisible`;
  move/will-resize → `onDragStart`, moved/resized → `onDragEnd` (a per-window
  `dragSettling` flag coalesces the high-frequency move/resize stream to one
  hide); deletes the controller on `closed`.
- Renderer `components/ProjectTerminals.tsx` docked mode: renders a
  `.terminal-dock-host` placeholder, **auto-opens** the terminal once when the
  pane is shown AND the tab has a root (parity with the airlock default's
  auto-spawn), and reports the pane rect + `{shown, overlayActive}` (mount +
  `ResizeObserver` + window resize, plus a 300/900/1800/3000ms post-open
  schedule to catch launch latency). `lib/dockSignals.ts` = pure `overlayActive`
  (search / references / appPage overlays cover the pane → hide the window).

**Gotchas:**
- **Boundary:** the renderer imports only `import type { DomRect }` from
  `shared/ipc` — NEVER value-imports `dock.ts` from agent-core (same native-dep
  packaging trap as the rest of the renderer; see the boundary note above).
- **macOS-only**, and requires the user to grant Accessibility (the
  `terminal:openExternal` prompt is `prompt:true`). Non-darwin →
  `accessibilityTrusted` is always false → free window.
- **One controller per window, overwritten per open.** With two docked tabs in
  one window the controller tracks whichever opened last (v1 scope); background
  tabs report `shown:false` (their hidden pane is 0×0) so they hide cleanly.
- Runtime behavior (the real window docking) is **not unit-testable** — the pure
  helpers + controller are tested; the Electron/osascript wiring is verified by
  manual smoke (per the testing convention).

Spec: `docs/superpowers/specs/2026-06-12-dock-external-terminal-design.md` ·
Plan: `docs/superpowers/plans/2026-06-12-dock-external-terminal.md`.
