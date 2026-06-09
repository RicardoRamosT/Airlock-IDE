# Claude session quota meter — design

Date: 2026-06-09
Status: design (pending implementation plan)

## Goal

Show a live, integrated UI meter in AirLock for the user's **Claude
subscription usage limit** — how much of the rolling allowance has been
consumed (0 → max) and how long until it resets. This is the number Claude
Code's `/usage` view surfaces ("current session … resets at <time>"), driven by
the account's rolling usage windows.

This is explicitly **NOT** the context window / auto-compaction gauge. It is the
plan-quota meter.

## Non-goals (YAGNI)

- Absolute token *counts* against the limit. The plan's raw token max is not
  exposed locally; only a `used_percentage` is. Percentage is the honest
  number we render.
- Historical usage graphs / sparklines.
- Cross-device usage reconciliation (claude.ai web, other machines).
- Desktop/OS notifications when nearing the limit.
- Per-terminal meters. The quota is **account-wide**, so there is exactly one
  global meter regardless of how many Claude terminals are open.

## Data source decision

`rate_limits` is exposed in exactly one place: Claude Code's **statusLine
command payload** (stdin JSON). There is no file, env var, OTel metric, or API
header a host can read for it. The statusLine JSON includes:

```json
"rate_limits": {
  "five_hour":  { "used_percentage": 23.5, "resets_at": 1738425600 },
  "seven_day":  { "used_percentage": 41.2, "resets_at": 1738857600 }
}
```

- `used_percentage`: 0–100, current consumption in that window → the 0→max fill.
- `resets_at`: Unix epoch **seconds** when the window resets → the countdown.

Known constraints we design around:

- `rate_limits` appears **only after the first Claude API response** in a
  session, and **only for Pro/Max (claude.ai) subscribers**. Free / API-key
  users never receive it.
- Each window (`five_hour`, `seven_day`) may be **independently absent**.
- It is a **newer** statusLine field — treat every field as optional and
  version-tolerant; never assume presence.
- The plan's absolute token max is not present (only the percentage).

Rejected alternatives: transcript-JSONL summing (can't know plan max, true
reset boundary, server-side normalization, or cross-device usage — inaccurate);
TUI `/context`/`/usage` scraping (visual-only, not machine-readable); OTel
(no documented quota metric, interval-exported, needs a collector).

Because `rate_limits` lives only in the statusLine payload, AirLock must
register a statusLine command and **siphon** its JSON into the UI.

## Architecture

Five units, each independently testable.

### 1. `statusline-emit` (bundled first-party script)

A small script shipped inside the app (first-party / vetted — consistent with
AirLock's "no third-party extensions" stance).

Responsibilities:
1. Read the full statusLine JSON from stdin.
2. Extract `rate_limits`, `model`, `session_id`, and a wall-clock stamp.
3. **Atomically** write them to the side-channel file (`--out <path>`, write to
   `<path>.tmp` then `rename`), so a concurrent read never sees a torn file.
4. **Chain**: if a previously-configured user statusLine exists, exec it with
   the *same* captured stdin and pass its stdout through as this command's
   output, so the user's own footer is preserved untouched. If none, print a
   minimal footer (or nothing).

Runtime / packaging: invoked via the app's **own** Node/Electron runtime — do
NOT assume `node`/`jq` on PATH. Use `ELECTRON_RUN_AS_NODE=1 "<app electron
binary>" "<abs path to statusline-emit.js>"` in production; fall back to `node`
in dev. The script and its path must resolve correctly in the packaged app
(electron-builder bundles only prod deps — this is an app dep with an explicit,
gated path, per the packaging-deps gotcha). The `--out` path is baked into the
installed command string by AirLock, so the script needs no PATH/env discovery.

### 2. Statusline installer (main process)

Opt-in. When `prefs.quotaMeter.enabled` is true, ensure Claude Code's
statusLine points at `statusline-emit`:

- Target: the user's **global** `~/.claude/settings.json` (the quota is
  account-global, so a single global install matches the data's scope and gives
  one install/uninstall to manage). The pre-existing `statusLine` value, if any,
  is recorded so the emitter can chain it and so uninstall restores it exactly.
- The installed command string contains: `<runtime> <abs statusline-emit.js>
  --out <abs side-channel path>`.
- Idempotent: re-running detects our marker and does nothing.
- Reversible: disabling the toggle restores the saved prior statusLine (or
  removes the key if there was none) and is the complete uninstall.
- Never clobbers: if `statusLine` is already ours, leave it; if it's the user's,
  record + wrap it (chaining), never discard.

Open decision (flag at review): global vs project-local
(`.claude/settings.local.json`) install. Recommendation: **global-chained** for
simplicity and because the data is account-wide. Project-local is the
zero-global-touch alternative but multiplies the install across every opened
project.

### 3. Quota watcher (main process)

Watches the side-channel file with the existing chokidar/`fsWatch`
infrastructure. On change: read + parse JSON, validate defensively (all fields
optional), and broadcast to every window via
`webContents.send("quota:changed", status)` — mirroring the existing
`activity:changed` broadcast pattern. Holds the latest parsed status in memory
so a newly-opened window can fetch it synchronously via `quotaGet()`.

### 4. IPC contract (`packages/app/src/shared/ipc.ts`)

New shared type:

```ts
export interface QuotaWindow {
  usedPercentage: number; // 0–100
  resetsAt: number;       // Unix epoch seconds
}
export interface QuotaStatus {
  fiveHour?: QuotaWindow;
  sevenDay?: QuotaWindow;
  model?: string;         // e.g. "claude-opus-4-8[1m]"
  updatedAt: number;      // epoch seconds of last emit
  available: boolean;     // false until first emit / non-subscriber
}
```

New `AirlockApi` members:

```ts
quotaGet(): Promise<QuotaStatus>;
onQuotaChanged(cb: (s: QuotaStatus) => void): () => void;
```

`AppPrefs` gains:

```ts
quotaMeter: { enabled: boolean }; // default false (opt-in: it edits Claude settings)
```

No secret value, token, or terminal output crosses this boundary — only
percentages, a reset timestamp, and a model string. Consistent with the
no-secret-value IPC invariant.

### 5. `QuotaMeter` (renderer component) + placement

A store slice subscribes to `onQuotaChanged` (seeded by `quotaGet()` on mount)
and holds the latest `QuotaStatus`. The reset **countdown ticks client-side**
off `resetsAt` (a 1s interval formatting `resetsAt - now`); no polling of main.

Placement — pinned bottom-left of the sidebar, never overlapping the project
sections:

The sidebar is already a flex column:

```
<aside class="sidebar">  // display:flex; flex-direction:column; min-height:0
  <div class="sidebar-sections"/>  // flex:1; min-height:0; overflow-y:auto  (Files, Git, …)
  <SidebarFooter/>                 // flex:none  (accounts + settings buttons)
</aside>
```

Insert `<QuotaMeter/>` as a `flex:none` card **between `.sidebar-sections` and
`<SidebarFooter/>`**. Because `.sidebar-sections` is `flex:1; overflow-y:auto`,
reserving fixed height below it makes the scroll region shrink — the project
sections reflow above the meter and scroll, and the meter never overlaps them.
This satisfies: bottom-left, no overlap, sections give way / scroll to see more.

Visual (always-expanded card showing both windows, matching the determinate
progress style already used by `ActivityItem`):

```
┌ sidebar bottom ────┐
│ Plan usage         │
│ 5h ▓▓▓▓░░░░░ 39%    │
│ 7d ▓▓░░░░░░░ 22%    │
│ ↻ resets 1h12m     │
└────────────────────┘
[ accounts ] [ gear ]   ← existing SidebarFooter row, unchanged
```

(The meter shows the 5-hour window's reset as the primary countdown; the 7-day
reset is available on hover/title.)

## Data flow

```
claude (PTY) ── turn ──▶ statusLine command = statusline-emit
   emit ── atomic write ──▶ <userData>/quota/rate-limits.json  (rate_limits, model, ts)
   chokidar ──▶ Quota watcher (main) ── parse ──▶ webContents.send("quota:changed")
   preload onQuotaChanged ──▶ store slice ──▶ <QuotaMeter/>  (countdown ticks locally)
```

## States & graceful degradation (all expected, not errors)

- **Waiting**: `available:false` (no emit yet / before first response / toggle
  just enabled) → "Waiting for Claude…" placeholder.
- **Subscriber-only fields absent**: emit arrived but no `rate_limits` (free /
  API-key user, or version without the field) → after a grace period show a
  one-line "rate limits unavailable" note rather than an empty bar.
- **One window only**: render whichever of `fiveHour` / `sevenDay` is present.
- **Stale**: no update in N minutes → dim the card + "as of HH:MM".
- **Disabled**: `quotaMeter.enabled` false → card not rendered; statusLine
  uninstalled.

## Security / ethos notes

- The emitter is first-party and vetted; no extension system is introduced.
- Editing `~/.claude/settings.json` is opt-in, chained (never hijacks the user's
  statusLine), recorded, and fully reversible. The toggle copy states plainly
  that enabling installs a chained Claude Code statusLine.
- No CSP impact: this is main-process file IO + IPC only; no remote resources,
  `data:`/`blob:` URLs, or renderer network access.

## Version-dependence / risks

- `rate_limits` is a recent, lightly-documented statusLine field. All parsing is
  defensive and optional. If `available:true` but `rate_limits` never appears
  across many turns while enabled, surface a "your Claude Code version may not
  report rate limits" hint rather than failing.
- statusLine refresh is event-driven (per turn + certain events). That is ample
  for a quota meter (quota changes per turn, not per keystroke); the countdown
  is local, so the card stays live between emits.

## Testing

Pure unit tests, matching existing `.test.ts(x)` conventions:

- emitter: JSON parse/extract; atomic-write target; chaining (prior command
  invoked with same stdin, stdout passed through; no-prior case).
- installer: idempotent install; chaining preserves prior value; disable
  restores exact prior state; never clobbers our own marker.
- watcher: parse valid/partial/garbage payloads; broadcast shape; latest-in-
  memory for `quotaGet()`.
- countdown formatting: future/now/past, h/m/d rollovers.
- `QuotaMeter` render states: waiting / 5h-only / both / stale / unavailable.

## Decisions to confirm at spec review

1. Global vs project-local statusLine install (recommend global-chained).
2. Always-expanded card vs collapsed bar + popover (spec assumes always-expanded
   card, per the "sidebar footer widget" placement choice).
