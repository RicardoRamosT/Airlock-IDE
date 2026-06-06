# Project tabs (multiple projects in one window)

**Date:** 2026-06-05
**Status:** v1 implemented (T1-T5: store + tab strip + main sync + agent
scoping + openProjectsAsTabs toggle + store tests), reviewed; pending owner
live gate. 306 tests green.

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

## Addendum (2026-06-05): blank tabs, unified New Window, window titles
Owner feedback after the first gate: the dock "New Window" spawned a second,
disconnected window (defeating the unify-into-tabs goal), and there was no way
to open a tab WITHOUT immediately picking a folder -- and opening a folder from
the no-folder scratch state KILLED a running terminal (e.g. a live `claude`
session), forcing a restart. This addendum fixes all three.

### Blank tabs (first-class)
- A tab is `{ id, root: string | null }`; `root === null` is a BLANK tab (no
  folder). The window always has >= 1 tab in tabs mode: fresh launch opens one
  blank tab, and closing the last tab opens a fresh blank tab (instead of the old
  activeTabId-null "implicit" state). The retired implicit state is replaced by a
  real blank tab with a real id; `IMPLICIT_TAB_ID` is removed (or repurposed as
  the initial blank tab's id -- implementer's call, but blank tabs must be real
  `tabs[]` entries so the user can have several).
- A blank tab renders today's no-folder UI (the "Open Folder..." button, the
  "open a folder first" sidebar sections) AND a working terminal -- but as a real
  tab in the strip, labeled "New Tab". Its terminals live under `tabTerminals[id]`
  like any tab.

### `+` and New Window open a blank tab (no forced dialog)
- The tab-strip `+` calls a new `openBlankTab()` (append `{id, root:null}`, park
  the outgoing snapshot, make it active, fresh empty snapshot + empty terminals)
  -- NO folder picker.
- Dock "New Window" + File-menu both branch on the `openProjectsAsTabs` pref
  (main reads it via `loadPrefs`):
  - tabs mode (default): open a blank tab in the focused window (create a window
    only if none exists). The File-menu item reads "New Tab" (Cmd+T); the dock
    menu is rebuilt to match.
  - windows mode (toggle off): a separate OS window (today's behavior). The item
    reads "New Window" (Cmd+Shift+N).
  - The menu/dock relabel + accelerator swap happen when the pref changes and on
    startup (rebuild the app menu + `app.dock.setMenu`).

### Open Folder: keep a busy terminal, never kill a running session (the key fix)
Opening a folder always lands you in a folder-rooted terminal (today's feel). The
bug is that it does so by DISCARDING the current terminal and spawning a new one
-- which kills a running `claude`. The fix: do not discard a BUSY terminal.
- BLANK active tab + open folder: attach the folder to that tab (set root in
  place) and:
  - if the tab's active terminal is IDLE (no running child process): replace it
    with a fresh folder-rooted terminal (exactly today's feel).
  - if it is BUSY (a `claude`/server is running): KEEP that terminal and open a
    NEW folder-rooted terminal alongside it (the new one becomes active; the busy
    one stays reachable via the per-tab terminal tabs). Nothing is killed.
- Active tab that already HAS a project + open folder: a NEW tab (tabs mode) or
  replace-in-place (windows mode), exactly as today.
- Busy/idle detection is main-side: a `pty:isBusy(sessionId)` IPC checks whether
  the shell pid has a child process (`pgrep -P <pid>`). No process is auto-killed.
- Agent visibility: the freshly spawned folder-rooted terminal carries the window
  root at spawn, so `sessionRoots` maps it and the agent sees it. A preserved busy
  terminal was spawned with a different/no root, so it is NOT in the folder's
  `sessionRoots` and the agent does not see it -- correct, since it runs in a
  different directory. No `pty:setRoot` adoption is needed.

### Running-process notice (owner request)
When opening a folder KEEPS a busy terminal (the `claude`-is-running case), show a
small notice on the new folder-rooted terminal: the running session is still in
its original directory and must be restarted here to work in this folder. Honest
about the hard limit (a running process cannot be relocated), e.g.: "Claude is
still running in <prev-dir>. This terminal is in <folder> -- run `claude` here to
give it this folder's context." Optional affordance: a "Start Claude here" button
that types `claude\n` into the new terminal.
- Two dismiss controls: an "x" (dismiss this once) AND a "Do not show this again"
  button that PERSISTS the choice so the notice NEVER appears again.
- Persistence: a new app-global pref `showRunningProcessNotice: boolean` (default
  true), plumbed like clipboardClearSeconds (AppPrefs + prefs default/sanitize +
  prefs:get/set + usePrefs hydrate). "Do not show this again" sets it false; the
  notice is gated on it. (Also surfaced as a re-enable toggle in Settings >
  Layout, so it is recoverable.)
- The notice shows only in the keep-a-busy-terminal case AND only when
  `showRunningProcessNotice` is true.

### Honest limit (unchanged, now surfaced in-app)
A running process keeps the cwd it started in; airlock cannot move a live
shell/`claude` into a newly opened folder (the sidebar + MCP tools follow the new
root, but the process does not). The cleanest flow stays open-folder-then-run; the
notice above makes this explicit at the moment it matters.

### Window title = "airlock - <folder>" (dock + Window menu)
- On every active-root change (open / setActive / attach-to-blank / close), main
  sets the sender window's OS title via `win.setTitle(...)`:
  `airlock - <basename(root)>`, or just `airlock` when the active tab is blank.
  This is what the dock window-list and the macOS Window menu read, so windows
  are named by their project. (The custom React titlebar already shows the name;
  this fixes the OS-level title the dock uses.)

### Dock menu: recent projects (owner request)
The dock icon's right-click menu lists RECENT PROJECTS (from `recentFolders` in
prefs), like VS Code, so a project opens in one click:
- `app.dock.setMenu` items = the recent-project entries (label = folder basename;
  on a basename collision, disambiguate with the parent dir), a separator, then
  the New Tab / New Window item (per the openProjectsAsTabs mode).
- Clicking a recent opens that folder via the normal open path (recents + MCP
  register + window-root set + title): focus an existing airlock window and open
  it there (a TAB in tabs mode; the window's project in windows mode), or create a
  window if none is open.
- Rebuild the dock menu when `recentFolders` changes (after any open), on startup,
  and when `openProjectsAsTabs` flips (New Tab vs New Window relabel). Cap to the
  existing recentFolders cap; a now-missing folder is skipped or surfaces an error
  (v1 may simply attempt the open).

### Security (unchanged invariant)
- A blank tab has no project -> while it is active `lastFocusedRoot()` is null ->
  the agent sees no workspace and no terminals. A folder-rooted terminal spawned
  after attach maps into `sessionRoots` at spawn (agent sees it); a preserved busy
  terminal stays unmapped (agent cannot see it). No new secret-value surface; the
  new IPCs (`pty:isBusy`, dock open-recent) carry only a session id / a path;
  `tools.ts` / the 12-tool allowlist / the redactor are untouched.

### This re-gates project tabs
- The store-model change (blank tabs replacing the implicit state) reworks
  openProject/closeTab/setRoot/replaceActiveProject + the terminal rendering +
  store.test.ts, so the whole feature is re-reviewed + repackaged before the next
  owner gate.

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
