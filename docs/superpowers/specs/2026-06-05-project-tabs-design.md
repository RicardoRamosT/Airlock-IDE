# Project tabs (multiple projects in one window)

**Date:** 2026-06-05
**Status:** Design -- pending owner review (biggest renderer change yet).

## Overview
One airlock window holds N projects as TABS. Click a tab and the window becomes
that project (its tree, git, secrets, viewer, and the agent). Each tab's
TERMINALS keep running when you switch away (mounted but hidden -- ptys are not
killed). The agent (MCP) operates on the active tab. Complements multi-window:
project tabs for one screen, separate windows for two monitors.

## The crux (confirmed feasible)
Terminals survive a CSS hide today: `TerminalManager` renders every terminal and
toggles `.hidden { display:none }`; the pty is killed ONLY on React unmount
(`TerminalPane` cleanup). So project tabs must keep ALL projects' terminal panes
MOUNTED and hide inactive ones -- never unmount on switch. This is the same
"both panes always mounted, CSS toggle" pattern the split/terminal-tabs already
use, extended across projects.

## Store model
Lift the per-project subset (exactly the current `setRoot` reset list) into a
`Project` record; key by tab id:
- `Project = { id, root, selectedFile, file, secrets, config, gitStatus,
  terminals, activeTerminalId, splitTerminalId, diff, dbView, settingsOpen }`.
- `projects: Project[]` (ordered = tab order) + `activeId: string`.
- APP-GLOBAL stays top-level (shared across tabs): `theme`, `sectionVisibility`,
  `sidebarVisible`, `sidebarPosition`, `clipboardClearSeconds`, `layoutHydrated`,
  `modal` (one modal window-wide), and `openProjectsAsTabs` (the tabs-vs-windows
  toggle -- see below).
- `setRoot` is replaced by:
  - `openProject(root)` -- add a tab (a fresh Project from the old reset list) +
    main `workspace:open` (recents + MCP register) + make it active.
  - `switchProject(id)` -- flip `activeId` ONLY; NEVER touch any project's
    terminals; call main `workspace:setActive` (see below).
  - `closeProject(id)` -- remove the tab (its TerminalPanes unmount -> their ptys
    die, correct); pick a neighbor active; if last tab closes, go to the
    no-project state.
- All existing per-project setters (setSelected/setSecrets/git/terminal ops/...)
  operate on the ACTIVE project's slice via an `active(state)` selector.

## Component access
Per-project reads (`useApp((s) => s.root)` etc. across Sidebar/FileTree/Git/
Secrets/Viewer/StatusBar/DataGrid/Terminals) become reads of the ACTIVE project
(`useApp((s) => active(s)?.root)`). A mechanical sweep. On switch, cached
per-project state (secrets/config/git/viewer) restores instantly from the Project
record + a background refresh; the file TREE re-fetches on switch (brief, v1 --
caching the tree is a later polish). Terminals do NOT re-fetch -- they were never
unmounted.

## Terminal rendering (all projects mounted)
The terminal area renders EVERY project's terminals (one terminal subtree per
project), hiding inactive projects with the existing `display:none`. Each
project's terminal ops are scoped to that project. The auto-respawn-when-empty
effect keys on the per-project terminal list (a fresh tab gets one terminal; a
backgrounded empty project does not respawn spuriously).

## Main-side sync
On a tab switch the renderer calls a NEW lean `workspace:setActive(root)` IPC:
`setRootForEvent(e, root)` (so every requireRoot-gated IPC + the agent's
`lastFocusedRoot()` resolve to the active tab) + `onFolderOpen?.(root)` (point the
MCP registration at the active project). It does NOT re-order recents or rebuild
the menu (that is `workspace:open`, reserved for OPENING a new tab).

## Agent terminal scoping (refinement)
Multi-window scoped terminals per WINDOW (`sessionWindows`). With tabs, one window
holds many projects' terminals, so add `sessionRoots: Map<sessionId, root>` set in
`pty:create` (from `rootForEvent(e)`); `get_terminal_tail`/`listTerminals` filter
to the ACTIVE project's root (`lastFocusedRoot()`), so the agent sees only the
active project's terminals.

## Tab bar UI
A project-tab strip in/below the `hiddenInset` drag strip (`-webkit-app-region:
no-drag`), as a 4th `app-shell` grid row (38px title / tab-bar / 1fr / 22px). Each
tab: project name + close (x); a `+` opens a project (the existing openFolder
flow). The active tab is highlighted. The `TitleBar`'s per-project name becomes
redundant (the active tab shows it).

## App-global vs per-project (decided)
Sidebar collapse/position = GLOBAL chrome (unchanged); sidebar CONTENTS =
per-project. Settings tab content = global (its open/closed slot is per-project).
`modal` = global. `termCounter` stays a global unique counter (no id collisions).

## Toggle: tabs vs separate windows (Settings)
A new app-global pref `openProjectsAsTabs: boolean` (DEFAULT true), surfaced in
Settings (Layout section) as "Open projects as tabs". It selects what opening a
project does:
- **true (default) = tabs mode:** the project-tab strip shows; Open Folder / Open
  Recent / the tab "+" open the project as a TAB in the current window (this whole
  spec). A separate "New Window" (dock / File menu) still opens a new window, which
  itself uses tabs.
- **false = separate-windows mode (today's behavior, preserved exactly):** the tab
  strip is hidden; each window holds ONE project; Open Folder replaces the current
  window's project and "New Window" opens a separate window -- the multi-window
  feature exactly as it ships now. No behavior change vs the multi-window baseline.
Live + persisted to prefs like the other app-global settings; flipping it
shows/hides the tab strip and switches the open behavior. Edge: switching to
windows-mode while a window already has >1 tab keeps those tabs reachable (the
strip stays while >1 tab exists); new opens follow the new mode. Implementation:
the open dispatch (`openProject` / the menu:action handlers) branches on
`openProjectsAsTabs`; the tab strip renders only in tabs mode (or while >1 tab).

## Honest scope / limits
- ONE agent at a time (the active tab) -- same model as multi-window-follows-focus.
- The tabs/windows toggle (openProjectsAsTabs) lets users keep separate windows.
- The file tree re-fetches on tab switch (v1); viewer/secrets/git restore from
  cache instantly. Tree caching is a later polish.
- Split-view (two projects visible at once) is DEFERRED (the "Tabs + split" option).
- Tabs are not restored across app restart (open fresh; Open Recent is the path
  back) -- v1.

## Out of scope
- Split-view; per-project sidebar collapse; cross-restart tab restoration;
  per-window-AND-per-tab simultaneous agents.
