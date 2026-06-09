# Activity bar + single shared sidebar (UI reorganization)

**Date:** 2026-06-09
**Status:** Approved by owner mandate ("implement it" — interactive design review
waived, decisions delegated). Built on main, branch feat/ui-activity-bar.

The owner's report: "The IDE is starting to pile up and it's getting confusing —
upgrade the UI for a better organized view." This spec reorganizes the window
chrome around a VS Code-style **activity bar** with a **single sidebar shared
across the project split**.

## Problems today (evidence)

1. **The project split duplicates the entire sidebar.** Each `ProjectPane`
   renders its own `Sidebar` (`ProjectPane.tsx`), so a split shows two Files
   trees, two Secrets sections, two full Git panels (branch picker, push-as,
   fetch/pull/push, changes, commit box) and two `SidebarFooter`s — four-plus
   columns of chrome across one window.
2. **Eight stacked accordion sections don't scale.** `Sidebar.tsx` stacks
   files / secrets / git / activity / databases / docker / host / audit in one
   column. Heavy sections (Git) push everything below the fold; the quota meter
   squeezes it further. Adding any future section makes it strictly worse.
3. **Duplicated global chrome.** Accounts/settings buttons render once per pane;
   the quota meter needs a special-case (`isSecondarySplitPane`) to render once.
4. **Weak discoverability.** Hiding/showing sections lives behind a right-click
   on a section header or the View menu.

## Approaches considered

- **A. Activity bar (icon rail) + one-view-at-a-time sidebar, single sidebar
  shared across the split — CHOSEN.** The proven IDE pattern (the app already
  uses codicons and VS Code-like chrome). Scales to any section count, shows
  exactly one section's content at a time, halves split chrome, gives global
  buttons one home.
- **B. Exclusive accordion (auto-collapse siblings) + hide the secondary pane's
  sidebar.** Lighter touch, but the column still mixes 8 headers + 1 body,
  split semantics stay ambiguous, and it doesn't scale.
- **C. Horizontal tabs at the sidebar top.** Same "one at a time" model, but 8
  text tabs don't fit a ~260px column; icons in a vertical rail do.

## UX

**Activity bar.** A narrow vertical icon rail at the window edge (left by
default; follows the existing `sidebarPosition` pref, so "move sidebar right"
moves rail+sidebar together). One icon per *visible* section, in the existing
`Section` order: files, secrets, git, activity, databases, docker, host, audit.
`sectionVisibility` (View menu + MCP `set_sidebar_section_visibility`) now gates
**icons** instead of stacked sections — semantics unchanged.

- Click an inactive icon → that section becomes the sidebar's **active view**
  (shown alone, full height). If the sidebar is hidden, this also re-shows it.
- Click the active icon → toggle the sidebar body (rail stays). This is the
  SAME state as the existing `sidebarVisible` pref — no second collapse state;
  the layout button, View menu, and rail all drive one flag. The only change
  to `sidebarVisible=false` is that the rail remains visible.
- Right-click an icon → context menu with "Hide <Section>" (same action the
  section header offers today).
- Rail bottom: the Accounts and Settings buttons + popovers (moved out of
  `SidebarFooter`, which is deleted). They render once per window.
- Active icon gets the standard left-edge indicator + brighter color; tooltips
  show the section name.

**Sidebar (single, shared).** Rendered once at App level, not per pane.

- Header row: the active view's title, plus per-view actions (Files keeps its
  hover-revealed New File / New Folder buttons). When a project split is
  showing, the header also shows the focused project's name (root basename) so
  it is always obvious which project the sidebar reflects.
- Body: the active view's existing section component, unchanged: files →
  `FileTree` (or "Open Folder…" when the tab is blank), secrets →
  `SecretsSection`, git → `GitSection`, activity → `ActivitySection`,
  databases → `NeonSection`+`DatabasesSection`, docker → `DockerSection`,
  host → `LocalHostSection`+`RenderSection`, audit → `AuditSection`.
- **Binding: the sidebar always reflects `activeTabId` (the focused pane).**
  This matches the established rule that the focused pane drives the agent,
  menus, and window title. Clicking the other split pane re-binds the sidebar
  to that pane's project.
- Footer: `QuotaMeter`, pinned at the sidebar bottom as today. The
  `isSecondarySplitPane` dedup hack is deleted — there is only one sidebar.
- All icons hidden → rail shows just the bottom buttons; sidebar shows the
  existing "All sections hidden. Re-enable them from View → Sidebar." note.

**Project panes.** `ProjectPane` sheds its sidebar and becomes MainTabs + the
content region only. Split = two such panes beside the one shared sidebar.

**Command palette.** Add one command per visible section — "Show Files",
"Show Git", … — that sets `activeView` and ensures `sidebarVisible` is true.

## State model

- `activeView: Section` joins the app-global layout state in the store
  (default `"files"`), persisted in `AppPrefs` next to `sidebarVisible` /
  `sidebarPosition`, hydrated through the existing `usePrefs` path.
- Fallback rule (pure helper, unit-tested): if `activeView` is hidden by
  `sectionVisibility`, the effective view is the first visible section in
  `Section` order; if none are visible, there is no active view (empty state).
  Hiding the active view via menu/MCP therefore degrades gracefully without
  writing state.
- `prefs.ts` sanitizes `activeView` (unknown/missing → `"files"`).
- Composition: App renders `ActivityBar` + one `Sidebar` inside a
  `ProjectPaneContext.Provider value={activeTabId}` — every section component
  already reads its tab/root from that context, so they re-bind on focus
  change with zero changes to the sections themselves.
- `sidebarVisible`, `sidebarPosition`, `sectionVisibility`, the split model,
  menus, and MCP tools are unchanged.

## Component changes

| Component | Change |
| --- | --- |
| `ActivityBar.tsx` | **New.** Rail icons (visibility-gated, active state, hide context menu) + bottom Accounts/Settings buttons with existing popovers. |
| `Sidebar.tsx` | Rewritten: header (title + project badge + view actions) over the single active view's body + `QuotaMeter`. Accordion `Section` wrapper deleted. |
| `SidebarFooter.tsx` | Deleted (folded into `ActivityBar`). |
| `ProjectPane.tsx` | Sidebar + `.layout` wrapper removed; pane = MainTabs + content. |
| `App.tsx` | Composes `.workspace` = ActivityBar / Sidebar (focused-tab context) / panes area (single or split). Owns the sidebar-position/visible classes. |
| `QuotaMeter.tsx` | Unchanged UI; Sidebar no longer needs the secondary-pane guard. |
| `Palette.tsx` | + "Show <Section>" commands. |
| `theme.css` | New `.activity-bar` block; `.layout` per-pane rules become `.workspace` rules; split/panes/focus styles carry over. |

Main process: `prefs.ts` + `shared/ipc.ts` gain the `activeView` pref field.
Nothing else (menu wiring, MCP tools, quota pipeline) changes.

## Error handling

- Unknown/corrupt persisted `activeView` → sanitized to `"files"` on load.
- Active view hidden at runtime → effective-view fallback (above), no crash,
  no pref write.
- Blank tab focused (root null) → sections already render their empty states;
  Files shows "Open Folder…".

## Testing

- Store: `activeView` default, set-action, persistence hydration; effective-view
  fallback (active hidden → first visible; all hidden → null).
- `ActivityBar`: renders icons per `sectionVisibility`; click switches view;
  click-active collapses; right-click hides; bottom buttons open popovers.
- `Sidebar`: renders the active view's component; header shows project name in
  split; quota meter rendered exactly once.
- `App.smoke` updated for the new composition (one sidebar in split).
- Existing suites (`MainTabs.split`, FileTree, GitSection, …) must stay green —
  sections themselves are untouched.

## Cleanup riders

- Update the CLAUDE.md quota gotcha line ("renders once — `Sidebar.tsx` hides
  it on the secondary pane") to describe the single shared sidebar.
- Delete dead CSS for the per-pane sidebar layout and `SidebarFooter`.

## Out of scope

- Rail icon drag-reordering, badges/counters on icons, a bottom dock/panel,
  per-pane dual sidebars, theming changes, touching section internals.
