---
name: airlock-verify
description: Use inside AirLock to verify a feature end-to-end — drive it, then confirm the backend and renderer did not error and the UI rendered correctly.
---

# Verifying an AirLock feature

You are running inside AirLock and can drive + inspect it via MCP tools. Use this
loop to verify a feature actually works — the UI can look fine while the backend
throws.

1. **Baseline.** Record the current time as an ISO-8601 UTC timestamp (run
   `date -u +%FT%TZ` in a terminal). Everything after is "since" this.
2. **Drive the feature.** Exercise it with the driving tools:
   `open_tab`, `open_terminal` + `send_terminal_input`, `set_pref` to flip a
   feature on (e.g. `{ "key": "quotaMeter", "value": { "enabled": true } }`),
   `start_dev_server`, `run_command`, `open_app_page`. To drive/verify a SIDEBAR
   panel (Extensions, Secrets, Git, …), focus it with
   `set_pref { key:"sidebarVisible", value:true }` then
   `set_pref { key:"activeView", value:"extensions" }`, then `capture_screenshot`.
3. **Check the backend AND renderer.** Call `read_events` with
   `{ "level": "error", "since": "<baseline>" }`. ANY result is an error the UI
   may have hidden — report it with its `op` and message. Renderer crashes show
   up here too (category `renderer`). Use `get_terminal_tail` for command output.
4. **Check the frontend.** Call `capture_screenshot` and actually look at the
   rendered UI against what the feature should show.
5. **Report.** For each acceptance criterion: pass/fail, the evidence (event
   `op`s, screenshot observations, terminal output), and any errors found.

Notes:
- `capture_screenshot` and `set_pref` require Self-verification enabled
  (Settings → Claude). If they refuse, ask the user to enable it.
- `set_pref` accepts only UI/feature toggles — never security settings; a refusal
  there is by design.
- Never treat "no error shown in the UI" as proof the backend is clean — always
  run `read_events` against your baseline.
