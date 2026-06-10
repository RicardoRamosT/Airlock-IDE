# Auto-start Claude in terminals

**Date:** 2026-06-09
**Status:** Design approved by owner (default mode + design confirmed via Q&A).
Built on main, branch feat/auto-claude.

New terminals can automatically run `claude` so a project is agent-ready the
moment it opens. A Settings option controls the behavior; the owner chose
**"first terminal per tab" as the default**.

## Behavior

A three-mode app-global preference, `claudeAutoStart`:

- **`"first"` (default):** a newly created terminal auto-runs `claude` only if
  no *other* terminal in its tab is currently flagged as the auto-started one.
  Consequences:
  - Opening a project → its first terminal runs Claude.
  - `+` / split / agent-created terminals → plain shells.
  - Killing the auto-Claude terminal → the *next* new terminal in that tab
    auto-starts Claude again (the tab regains its session).
  - Opening a folder into a blank tab: `openPickedFolder` adds a fresh
    folder-rooted terminal; the blank tab's scratch shell was never flagged, so
    the new terminal qualifies → the project starts with Claude. (If the
    scratch shell was busy and kept, it keeps running untouched.)
  - Blank tabs count too: their first terminal runs Claude in `$HOME`.
  - Only AUTO-started sessions are tracked. A manually-typed `claude` does not
    set the flag, so an auto one may coexist with a manual one — accepted.
- **`"every"`:** every newly created terminal auto-runs `claude`.
- **`"off"`:** terminals never auto-run anything.

Mode changes apply to terminals created afterwards; nothing is sent to
already-running shells. The injected command is exactly `claude\n` — the same
write the existing "Start Claude here" notice button performs
(`ProjectTerminals.startClaudeHere`), so Claude runs *inside* the shell and
exiting it returns to the prompt.

## Architecture

Decide in the store (it owns tabs + terminal lifecycle), execute in the pane
(it owns the pty handle). Rejected: deciding in main's `pty:create` (main has
no tab/“first terminal” concept — that is renderer state) and spawning the pty
with `claude` as the command (terminal would die when Claude exits).

| Unit | Responsibility |
| --- | --- |
| `lib/autoClaude.ts` (**new**) | `CLAUDE_AUTO_COMMAND = "claude\n"` + pure `shouldAutoStartClaude(mode, existingTerminals): boolean`. `off`→false; `every`→true; `first`→ `!existingTerminals.some(t => t.claudeAuto)`. |
| `store.ts` | `TerminalEntry` gains `claudeAuto: boolean`. `addTerminal(tabId?)` stamps it via the helper using the TAB's current terminals + the `claudeAutoStart` mode. New app-global mirror `claudeAutoStart` + `setClaudeAutoStart`. |
| `TerminalPane.tsx` | In the `ptyCreate().then` adopt callback (after `setTerminalPty`), if this entry is flagged `claudeAuto`, write `CLAUDE_AUTO_COMMAND` via `window.airlock.ptyInput`. The callback runs once per terminal (panes stay mounted via the keep-alive portal), so no extra "sent" state is needed. |
| `shared/ipc.ts` + `main/prefs.ts` | `AppPrefs.claudeAutoStart: "off" \| "first" \| "every"`; default `"first"`; sanitize: unknown value → default. |
| `lib/usePrefs.ts` | Hydrate `claudeAutoStart` alongside the other layout prefs. |
| `SettingsTab.tsx` | In the existing "Claude" section: a `<select>` with the three modes + a one-line description. Persists via `prefsSet({ claudeAutoStart })` and mirrors to the store. |

## Error handling

- Typed-ahead input is safe: the `claude\n` bytes sit in the pty buffer until
  zsh reads them, so rc-file startup timing cannot drop the command.
- `claude` not installed → the shell prints `command not found` in that
  terminal; nothing else breaks. No detection logic (YAGNI).
- Corrupt persisted pref → sanitized to `"first"`.
- The agent-driven `open_terminal` path also goes through `addTerminal`, so
  agent terminals follow the same mode rules.

## Testing

- `lib/autoClaude`: all three modes; `first` with no/flagged/unflagged
  existing terminals.
- Store: `addTerminal` stamps `claudeAuto` per mode; kill-flagged-then-add
  re-flags; the `openPickedFolder` blank-tab flow flags the folder terminal
  (scratch unflagged); a second terminal stays unflagged.
- Prefs: defaults include `claudeAutoStart: "first"`; garbage sanitizes to
  `"first"`; valid values round-trip.
- `App.smoke.test.tsx`: stub prefs pin `claudeAutoStart: "off"` so the
  existing pty assertions stay deterministic (mirrors `quotaMeter.enabled:
  false` there); full-object prefs `toEqual`s gain the new field.

## Out of scope

- Configurable command/flags, per-project overrides, detecting an
  already-running Claude, retroactively starting/stopping sessions on mode
  change.
