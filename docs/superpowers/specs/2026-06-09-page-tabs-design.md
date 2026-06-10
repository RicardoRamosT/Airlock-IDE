# Page-tabs: Settings and Usage as tabs (v2: in the PROJECT strip)

**Date:** 2026-06-09
**Status:** v1 (main tab bar, mutually exclusive) superseded same-day by
owner feedback: the pages are IDE chrome, not project content, and must
COEXIST. v2 (branch feat/ide-page-tabs): app-level `appPage` ("settings" |
"usage" | null = shown page, rendered in the workspace panes slot with the
sidebar intact) + independent `settingsTabOpen`/`usageTabOpen` flags drive
two closable pseudo-tabs in the PROJECT strip. Selecting a project tab (or
opening/creating one, or opening a DB view) hides the page but keeps its tab;
✕ / Esc / Close Editor close it. `setSettingsOpen` remains as a compat shim
for existing callers (gear menu, Cmd-comma, agent); the per-tab
`ProjectState.settingsOpen` field is retired (always false). Implemented.

Settings and the Usage dashboard previously appeared with no tab presence
(Settings as an invisible in-pane overlay; Usage as a window-fixed sheet).
Both now read as TABS, the VS Code Settings-editor pattern.

## Design

- **Page-tabs, not PaneItems.** A closable `⚙ Settings` / `📊 Usage` tab is
  appended to the main tab bar while its page is open, shown active (real
  tabs' active highlight is suppressed meanwhile). The label is inert — the
  page is already on top; only ✕ acts. Chosen over extending the PaneItem
  scene model (splits/reorder/persistence ripple) for a fraction of the risk
  with the same UX.
- **Usage moves in-pane.** `UsageTab` renders in the pane content slot like
  SettingsTab (`.usage-page`, no more fixed overlay). The flag stays
  window-level (account-wide data) but renders in the FOCUSED pane only;
  its page-tab appears in that pane's bar.
- **One page at a time.** `setUsageOpen(true)` clears the focused tab's
  settings/db/diff; `setSettingsOpen(true)` / `setDbView(truthy)` clear
  `usageOpen`.
- **Real tabs dismiss pages.** `setView` (every focused-pane scene change:
  tab click, file open, new terminal) clears `usageOpen` — background tabs'
  scene churn (e.g. a pty exit) deliberately does not. Settings already
  behaved this way via per-caller overlay clears.

## Touched

`store.ts` (setView + setUsageOpen/setSettingsOpen/setDbView exclusions),
`MainTabs.tsx` (page-tabs + active suppression), `ProjectPane.tsx` (usage
content branch), `UsageTab.tsx` (de-overlay), `App.tsx` (window-level mount
removed), `theme.css` (`.usage-page`, `.page-tab-label`),
`store.usage.test.ts` (exclusions + scene-change dismissal).

## Out of scope

Drag/reorder of page-tabs, page-tabs in splits' secondary panes, making
DataGrid/diff page-tabs too (natural follow-up).
