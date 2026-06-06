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

### The signal (Claude-scoped, inferred -- honest limit)
airlock has no direct line into Claude's state; Claude is just a process in a
pty. So the dot is inferred from the terminal, scoped to Claude specifically:
- WORKING = a terminal in the tab is running `claude` AND that terminal produced
  output recently (Claude continuously redraws while working: spinner, tokens).
- not working = `claude` not running, or running but output has been quiet past a
  threshold (idle at the prompt / finished).
This is a close heuristic with ~1s lag, not a hook. A dev server / build does NOT
turn the dot yellow because the dot only counts terminals whose child is `claude`.

### Main: a Claude-activity monitor (non-blocking)
- Per-session last-output timestamp: `sessionLastOutput: Map<sessionId, number>`,
  updated in the EXISTING pty `onData` tee in ipc.ts (next to the ring-buffer
  write). Cheap (a timestamp), no spawn.
- A single interval (~900ms) does ONE async `ps -axo pid=,ppid=,command=`
  (NOT spawnSync -- must not block the main thread; NOT per-session pgrep), parses
  it into a ppid -> child-commands map, and for each live session computes:
  `working = childIsClaude(session.pid) && (now - lastOutput < ~1200ms)`.
  `childIsClaude` = any process whose ppid === the session's shell pid and whose
  command matches claude (comm "claude", or a command line containing a claude
  binary). Heuristic; acceptable.
- It keeps `sessionWorking: Map<sessionId, boolean>` and pushes ONLY on change:
  `webContents.send("pty:status", { id, working })` to that session's window
  (sessionWindows). The interval runs only while there are live sessions.
- No new secret surface: it reports a boolean per pty id; never output content,
  never a pid, never an MCP tool.

### Renderer: map sessions -> tabs, drive the dot + glow
- preload `onPtyStatus(cb)` subscribes to `pty:status`; shared type added.
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
- A subscription hook (e.g. in usePrefs or a new useClaudeStatus) wires
  onPtyStatus -> applyPtyStatus.

### CSS
Reuse the `.status-dot` vocabulary. Add `.project-tab-status` (gray default,
`.working` = yellow), and `.project-tab.glow` (a brief attention pulse using a
box-shadow/border keyframe in theme vars). Renderer/.css is ASCII-exempt.

### Honest limits
- ~1s lag (the poll + the quiet threshold). A very brief Claude turn may not flip
  the dot. Acceptable.
- `childIsClaude` is a process-name heuristic (`claude` binary or a command line
  containing claude). A process that merely has "claude" in its path could
  false-positive; rare.
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
  passes. pty:status (Feature A) is a renderer-only boolean push, never an MCP tool.

## Out of scope
- Persisting dismissed activity across restart; per-window dismiss (it is app-global).
- A true Claude-state hook (no such signal exists); the dot stays a heuristic.
- Per-step activity dismiss (whole entries only).
