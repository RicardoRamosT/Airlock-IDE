# Project split: two full project views side by side

**Date:** 2026-06-06
**Status:** Design -- pending owner review. Built on main (post projecttabs-v1.0),
on branch feat/project-split.

The owner-requested "Tabs + split" (deferred in the project-tabs spec): split the
window so TWO complete projects show side by side, each with its own file tree,
git, secrets, terminal, and viewer -- mirroring the terminal split, but for whole
projects. This is the largest refactor in the codebase; this spec is the plan of
record.

## UX
- A split button (in the project-tab strip, next to `+`) toggles project split.
  When ON, the content area shows TWO panes side by side: the active tab on the
  left, a second open tab on the right. Each pane is a full project view (its own
  Sidebar + viewer + terminals).
- Clicking anywhere in a pane FOCUSES it (the focused pane is the "active" tab).
  The focused pane drives the agent (MCP), the menu actions, and the window title.
- The right pane shows another OPEN tab; clicking a tab in the strip puts it in
  the focused pane (like the terminal split shows activeTerminalId + splitTerminalId).
- Toggling split off returns to the single (focused) pane. On a laptop this is
  tight but usable; the sidebars can be collapsed per the existing sidebar toggle.

## The core problem (and the decision)
Today every per-project datum (git, secrets, tree, config, audit, db, host) is
loaded by an IPC call that resolves the project via `requireRoot(e)` = the SENDER
WINDOW's single root. Two panes share one window (one webContents), so both would
resolve to the same root -- the non-focused pane would load the wrong project.

**Decision: explicit-root IPC.** Per-project IPC handlers gain an explicit `root`
argument; the renderer passes the PANE's root. Main validates it against the set
of currently-open roots (tracked per window) and falls back to the window root
when omitted (back-compat). The MCP/agent path is UNCHANGED -- the agent keeps
resolving to `lastFocusedRoot()` (the focused pane), so "one agent at a time" and
the whole no-secret-value invariant are untouched. (Rejected alternative: two
BrowserWindows / WebContentsViews -- clashes with the single-renderer project-tabs
model and doubles the renderer; the explicit-root change is mechanical and keeps
one coherent renderer.)

## State model
Lift the top-level per-project fields into a per-tab record so any tab's full
state can render independently (today only the active tab's is live; others are
parked snapshots):
- `ProjectState = { root, selectedFile, file, secrets, config, gitStatus, diff,
  dbView, settingsOpen }` (the current top-level set + root).
- `tabState: Record<tabId, ProjectState>` -- ALWAYS live for every tab (this
  replaces the top-level lifted fields AND tabSnapshots; the park/load dance goes
  away -- a tab's state simply persists in tabState whether or not it is visible).
- `splitTabId: string | null` -- the tab shown in the second pane (null = single).
  Mirrors `splitTerminalId`. The two visible panes = [activeTabId] (+ splitTabId).
- `activeTabId` stays the FOCUSED pane (drives the agent + window root + menu).
- tabs / tabTerminals / tabGlow / sessionWorking: unchanged (already per-tab).
- App-global state unchanged + shared across panes: sidebarVisible/position,
  theme, clipboardClearSeconds, sectionVisibility, openProjectsAsTabs,
  showRunningProcessNotice, modal, runningNotice, layoutHydrated, the
  dismissed-activity set.

Tab actions (openProject/openBlankTab/fillActiveTab/replaceActiveProject/switchTab/
closeTab/setRoot) are rewritten to read/write `tabState[tabId]` instead of the
top-level + snapshots. switchTab/closeTab keep firing workspaceSetActive/Close for
the FOCUSED tab. closeTab also clears splitTabId if it closed the split pane.

## Pane context + the component sweep
A React `ProjectPaneContext` provides the current pane's `tabId`. Every per-project
component reads its pane's state via the context instead of the global top level:
- `const tabId = useProjectPane(); const root = useApp(s => s.tabState[tabId]?.root)`.
- Per-project setters take a tabId (the pane's): setSelected/setDiff/setSecrets/
  setConfig/setGitStatus/setDbView/setSettingsOpen all gain a tabId (default = the
  active tab for non-split callers).

Sweep list (every per-project consumer -- from the map):
- Readers: TitleBar (uses focused tab), FileTree, StatusBar, Viewer, DataGrid.
- Loaders (read + write + fetch): GitSection, SecretsSection, SettingsTab,
  DatabasesSection, AuditSection, useGitStatus.
- ProjectTerminals already takes a tabId (reuse).
- App-global sections render once (shared), NOT per-pane: ActivitySection,
  DockerSection, RenderSection, NeonSection are account/machine-global. Host is
  per-root, so it becomes per-pane. (Decision: per-pane sidebars each show their
  project's Files/Git/Secrets/Databases/Host/Audit; the account/machine-global
  sections -- Activity/Docker/Render/Neon -- render in BOTH sidebars reading the
  same shared data, OR only in the focused pane's sidebar -- see Open questions.)

## Per-pane data loading
Each visible pane's loaders key on THAT pane's root and pass it explicitly to IPC:
- FileTree listDir(root, "."); GitSection gitStatus(root)/gitBranches(root);
  SecretsSection secretsList(root)/configGet(root); AuditSection auditRead(root,20);
  DatabasesSection dbList(root)/dbPing(root,...); useGitStatus gitIsRepo(root)/
  gitStatus(root); LocalHost hostLocalUrl(root). Each effect's deps include the
  pane's root; the window-focus refresh listeners refresh BOTH visible panes.
- The DataGrid (db/neon rows) keys on the pane's dbView + passes root.

## Main: explicit-root IPC (the ~30 handlers)
- Add a helper `resolveRoot(e, explicit?)`: if `explicit` is a non-empty string AND
  is in the window's known-open roots, use it; else `requireRoot(e)` (window root).
- Track open roots per window: a `windowRoots: Map<winId, Set<root>>` updated as the
  renderer opens/closes tabs (a lean `workspace:roots(roots[])` IPC the store calls
  when tabs change), so an explicit root must be one the user actually opened
  (defense in depth -- the renderer cannot point a handler at an arbitrary path).
- Sweep the per-project handlers (fs:listDir/readFile, secrets:*, config:*,
  audit:read, git:*, db:*, host:localUrl) to take the optional root + use
  resolveRoot. Preload + AirlockApi types gain the optional root arg; renderer
  callers pass the pane root.
- UNCHANGED: the MCP tools + getWorkspaceRoot=lastFocusedRoot (agent = focused
  pane), workspace:open/setActive/close, prefs, sections, neon/render/docker/
  activity (account/machine-global), github (per-window). The source-guard +
  14-tool allowlist + redactor are untouched -- no new agent surface, no secret
  value crosses anything new.

## Layout + the split UI
- The `.layout`/`.main` grid stays for a single pane. For split, the content area
  becomes two `ProjectPane` columns (each = Sidebar + main for its tabId), 50/50,
  with a 1px divider (mirror `.terminal-panes.split`). A new `.project-split`
  grid: `grid-template-columns: minmax(0,1fr) minmax(0,1fr)`.
- Each ProjectPane wraps its subtree in `<ProjectPaneContext value={tabId}>` and
  marks itself focused/unfocused (a class + an onFocusCapture -> setActiveTab).
- The split toggle lives in the project-tab strip; disabled when < 2 tabs (need a
  second project to split with). Toggling on picks a neighbor tab as splitTabId.

## Security (invariant preserved)
- The agent still resolves to `lastFocusedRoot()` (the focused pane); it never gets
  an explicit-root path. No new MCP tool; allowlist stays 14; getSecretValue/
  getGlobalSecret stay non-tools; the redactor + source-guard are untouched.
- Explicit-root is a RENDERER->main convenience, validated against the set of
  user-opened roots, so a handler can only ever act on a project the user opened
  (no arbitrary-path access). Per-window isolation is preserved.

## Honest scope / risk
- This is the biggest change in the repo: the store per-project model, ~12
  components + 1 hook swept to pane-context, ~30 IPC handlers + their preload/
  types/callers gaining explicit-root, and the split layout. It will land as
  several reviewed tasks with the full gate between phases.
- Laptop screen real estate: two full sidebars + two work areas is tight; the
  existing sidebar collapse helps. Acceptable per the owner's choice.
- One agent at a time (the focused pane) -- unchanged.

## Open questions (to confirm in review)
1. Account/machine-global sidebar sections (Activity, Docker, Render, Neon): show
   in BOTH panes' sidebars (duplicated, same data) or only the focused pane's? (Lean:
   show in both -- each sidebar is self-contained; the data is shared/cached so no
   double fetch beyond a render.)
2. Split limited to TWO panes (left/right), matching the terminal split? (Lean: yes.)
3. The split toggle: a neighbor auto-picked as the right pane, then click any tab to
   reassign the focused pane (like terminal split)? (Lean: yes.)

## Out of scope
- More than two project panes; vertical split; per-pane sidebar collapse state
  (collapse is app-global); persisting the split across restart.
