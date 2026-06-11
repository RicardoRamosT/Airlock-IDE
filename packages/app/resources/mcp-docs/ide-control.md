# IDE control - drive the focused window's layout

Nine tools let you drive the **layout** of the focused airlock window: its tabs, the
split view, its terminals, and the IDE page-tabs (Settings / Usage). They are how you
arrange the workbench around yourself - open the project you are about to work on as a
tab, split it beside another, spin up a terminal to run something, surface the Usage
dashboard for the human, tidy up when done.

> **Layout metadata only - no secret values.** These tools carry only tab ids,
> terminal ids, a folder path, or a page name going in, and they return only **layout
> metadata** - each tab's id, name (the folder basename, or "New Tab"), root, whether it
> is focused or in the split, and its terminals as `{ id, title }`, plus the split pair
> and the page-tab state. They return **no** secret value, no environment value, and no
> terminal output. `open_terminal` spawns a shell with the project's secrets injected
> (the same as a terminal the human opens), but you never see those values - no tool here
> returns them, and reading a terminal's output still goes through `get_terminal_tail`,
> which redacts. So these tools do not widen the no-secrets surface at all (see
> `security-model.md`).

> **They act on the FOCUSED window.** Like the rest of your tools, these resolve to the
> last-focused window - the window the human is actually using (see `overview.md`). If no
> airlock window is open they return an error.

## The layout shape

`list_tabs` (and every other tool here, on success) returns:

```
{
  "tabs": [
    {
      "id": "proj-1",
      "name": "my-app",          // folder basename, or "New Tab" for a blank tab
      "root": "/path/to/my-app", // null for a blank tab
      "focused": true,           // is this the focused tab?
      "inSplit": false,          // is this tab a member of the split pair?
      "terminals": [ { "id": "term-1", "title": "zsh" } ]
    }
  ],
  "split": null,                 // or { "a": "<tabId>", "b": "<tabId>" } when split
  "appPages": {                  // the IDE page-tabs (app chrome, NOT in `tabs`)
    "open": ["usage"],           // which of "settings" / "usage" have a tab open
    "shown": null                // the page currently shown, or null (a project tab is)
  }
}
```

> **Page-tabs are separate from project tabs.** Settings and the Usage dashboard are IDE
> page-tabs in the same strip — they are NOT in `tabs` and have no tabId. Drive them with
> `open_app_page` / `close_app_page` (below); their state is reported in `appPages`.

## The tools

- **`list_tabs`** - return the layout above for the focused window. No args. Call it
  first so you know the tab ids / terminal ids to pass to the other tools, and to see
  what is open.
- **`open_tab`** - open a tab in the focused window. With `path` (a folder path) it opens
  that **project** as a NEW tab (airlock sets the window root, adds it to recents, and
  registers its MCP server, exactly like the human opening it). With **no** `path` it
  opens a **blank** tab. Returns the new layout.
- **`close_tab`** - close a tab by `tabId` (from `list_tabs`). Closing the last tab leaves
  a fresh blank tab (the window always keeps at least one). Returns the new layout.
- **`switch_tab`** - focus a tab by `tabId`. The focused tab drives your "current
  project" (git/secrets/run_command/terminals all follow it). Returns the new layout.
- **`split_view`** - toggle the split. With a `tabId`, split the focused tab (left) beside
  that tab (right). Add `anchorTabId` to make THAT tab the left/primary instead of the
  focused one - naming BOTH ids splits exactly that pair no matter what is focused, so a
  focus change between your calls cannot re-aim the split (recommended). With **no** `tabId`,
  split the focused tab beside a new blank tab - or, if the split is already showing,
  collapse it. Returns the new layout.
- **`open_terminal`** - open a new terminal. With a `tabId`, open it in that tab (the tab
  is focused first, since a new terminal lands in the focused tab); with no `tabId`, open
  it in the focused tab. Returns the new layout (the tab's `terminals` now include the new
  one - read its `id` from there). Spawns a shell with the project's secrets injected; you
  see no values.
- **`close_terminal`** - close a terminal by `terminalId` (from `list_tabs` or the
  `open_terminal` reply). Returns the new layout.
- **`open_app_page`** - open an IDE page-tab and show it. Arg `page`: `"settings"` or
  `"usage"`. Both pages can be open at once; at most one is shown (opening one shows it,
  and opening an already-open page just brings it back into view - the human may have a
  project tab selected over it). Returns the new layout (`appPages` reflects it).
- **`close_app_page`** - close an IDE page-tab by `page` (`"settings"` or `"usage"`).
  Closing a page that is not open is a no-op. Returns the new layout.

## Picking a tool

- "Open this project / a scratch tab" -> `open_tab` (with a path, or none for blank).
- "Switch to / focus tab X" -> `switch_tab` (after `list_tabs` for its id).
- "Put these two side by side" -> `split_view` with `anchorTabId` (left) + `tabId` (right),
  so the pair is exactly those two regardless of focus.
- "Give me a terminal to run X in" -> `open_terminal`, then `run_command` (or read it
  later with `get_terminal_tail`).
- "Show me my usage / open Settings" -> `open_app_page` with `"usage"` / `"settings"`
  (to READ the usage data yourself, use `plan_usage` - no page needs to be open).
- "Tidy up" -> `close_tab` / `close_terminal` / `close_app_page`.
- These change LAYOUT; they never read a secret. To run something with a credential use
  `run_command`; to read a terminal's output use `get_terminal_tail` (both redact).
