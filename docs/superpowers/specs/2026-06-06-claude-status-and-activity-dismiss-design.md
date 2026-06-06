# Claude status dot (per tab) + Activity entry dismiss

**Date:** 2026-06-06
**Status:** Design -- pending owner gate. Built on feat/project-tabs (on top of
project-tabs v1 + v2).

Two owner-requested features after the project-tabs v2 gate.

## Feature A: per-tab Claude status dot + finish glow

Each project tab shows a small status dot for the Claude session in that tab:
- GRAY: Claude idle / finished / not running.
- YELLOW: Claude is actively working.
- GLOW (tab pulses) when Claude FINISHES in a tab you are NOT looking at, so you
  know to switch back. The glow clears when you click/activate that tab. If you
  are already on the tab when Claude finishes, no glow (you can see it).

### The signal (Claude-scoped, on-screen indicator)
airlock has no direct line into Claude's state; Claude is just a process in a
pty. So the dot is read off Claude Code's OWN on-screen working indicator:
- WORKING = Claude Code's "esc to interrupt" status line is visible in the
  rendered terminal. While Claude is processing a turn it shows that line near
  the bottom; when it finishes, the line is replaced by the input prompt.
- not working = that marker is absent (idle at the prompt / finished).
Detected by a renderer-side scan of the xterm buffer's bottom rows (scoped to
the current screen via `baseY`, so scrolling into scrollback never
false-triggers). This is accurate and inherently Claude-scoped: output activity
would false-yellow on any keystroke/redraw because Claude Code is the running
process throughout the session. Honest limit: it is coupled to Claude Code's
wording -- if that status text changes, the marker must be updated.

### Renderer: scan the buffer, map sessions -> tabs, drive the dot + glow
- TerminalPane owns the xterm `Terminal`. A periodic scan (~600ms) reads the
  bottom ~10 rows of the live screen (`buffer.active.baseY + i`,
  `translateToString(true)`), tests `/esc to interrupt/i`, and calls
  `applyPtyStatus(ptyId, working)` ONLY on change. It runs for background
  (hidden) panes too -- their buffers keep updating under `display:none`, so the
  finish-glow fires for a tab you are not looking at; the scan is NOT gated on
  visibility. No main round-trip and no new secret surface: it reads the user's
  own terminal buffer in the renderer to set a boolean; never crosses to the
  agent, never an MCP tool.
- store: `sessionWorking: Record<sessionId, boolean>` + `tabGlow: Record<tabId,
  boolean>` + an action `applyPtyStatus(id, working)`:
  - compute the OWNING tab's working BEFORE the update (any of that tab's
    terminals' ptyIds working) and AFTER;
  - set `sessionWorking[id] = working`;
  - if the owning tab went working -> NOT working AND it is not the active tab,
    set `tabGlow[owningTab] = true`.
  (Owning tab = the tab whose tabTerminals contains a terminal with that ptyId;
  reuse the existing findOwningTabId-style scan but keyed by ptyId.)
- `switchTab(id)` clears `tabGlow[id]` (activating a tab dismisses its glow). A tab
  that is already active never gets a glow set (the applyPtyStatus guard).
- ProjectTabs.tsx renders, per tab: a status dot (yellow when the tab is working,
  else gray) and a `glow` class on the tab when `tabGlow[tab.id]`. Dot color is
  DERIVED (any session in the tab working); glow is the stored flag.
- The TerminalPane scan (above) calls `applyPtyStatus` directly; no IPC hook.

### CSS
Reuse the `.status-dot` vocabulary. Add `.project-tab-status` (gray default,
`.working` = yellow), and `.project-tab.glow` (a brief attention pulse using a
box-shadow/border keyframe in theme vars). Renderer/.css is ASCII-exempt.

### Honest limits
- Up to ~600ms lag (the scan cadence). A very brief Claude turn may not flip the
  dot. Acceptable.
- Coupled to Claude Code's wording: the marker is the literal "esc to interrupt"
  status text. If Claude Code changes that phrasing, the marker must be updated.
- One agent at a time today, but the dot is per tab so several tabs can each show
  their own session's state.

## Feature B: dismiss Activity entries (UI control + agent tool)

The Activity feed is LIVE (CI/Render/Docker derived from polling). Entries have
stable ids: `ci:<headSha>`, `render:<serviceId>`, `docker:<containerId>`.

### Dismiss model (main)
- `dismissedActivity: Set<string>` in main (app-global, in-memory -- activity is
  ephemeral; not persisted across restart, which is fine since the feed rebuilds).
- `activityStatus(root)` filters out ids in the set before returning.
- `activity:dismiss` IPC (renderer UI): adds the id to the set, then broadcasts
  `activity:changed` to ALL windows (like sections:changed) so every ActivitySection
  refetches and the entry disappears live.
- Re-appearance is correct: a dismissed `ci:<sha>` stays hidden, but a NEW run has
  a new sha -> a new id -> shows again. Dismissing a still-running entry hides it
  by id (the user chose to).
- Optional: `activity:clearFinished` to drop all currently done/failed entries.

### Activity UI
- ActivitySection.tsx: a hover-revealed dismiss "x" per entry -> `activityDismiss(id)`;
  subscribe to `activity:changed` -> refetch. (The refresh button stays.) Optional
  "Clear finished" button.

### Agent tools (MCP) -- TWO new tools, allowlist 12 -> 14
For the agent to dismiss an entry it must first SEE entries (and their ids), and
reading the Activity feed is a real gap today (the agent sees render/docker/git
sources but not the aggregated feed). So:
- `activity_status` (READ): returns the current ActivityItem[] for the focused
  project (the same list the sidebar shows), so the agent can see live
  CI/deploy/container progress and the entry ids. Status metadata only (titles,
  states, branches, urls) -- NO secret values, consistent with the other status
  tools.
- `dismiss_activity` (CURATE): input `{ entryId: string }`; calls the same dismiss
  path (add to set + broadcast). Returns ok. A mutating curate tool like
  set_sidebar_section_visibility.
- ToolDeps gains `getActivity: (root) => Promise<ActivityItem[]>` and
  `dismissActivity: (entryId: string) => Promise<void>` (or void+broadcast).
- tools.ts TOOL_NAMES becomes 14; tools.test.ts updates the count test (12 -> 14)
  and KEEPS the source-guard (getSecretValue/getGlobalSecret still forbidden). The
  redactor + the no-secret-value invariant are untouched -- activity items carry
  no secret values.
- The agent's built-in manual (mcp resources) gains an Activity page describing
  the two tools.

### Security
- No secret-value surface. activity_status returns the same metadata the sidebar
  shows (CI/deploy/container status). dismiss_activity carries an opaque entry id.
  getSecretValue/getGlobalSecret remain non-tools; the source-guard test still
  passes. The Feature A dot is a renderer-only buffer scan, never an MCP tool.

## Out of scope
- Persisting dismissed activity across restart; per-window dismiss (it is app-global).
- A true Claude-state hook (no such signal exists); the dot stays a heuristic.
- Per-step activity dismiss (whole entries only).
