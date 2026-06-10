# Auto-start Claude in terminals

**Date:** 2026-06-09
**Status:** Design approved by owner (default mode + design confirmed via Q&A).
Built on main, branch feat/auto-claude. Implemented on feat/auto-claude.

New terminals can automatically run `claude` so a project is agent-ready the
moment it opens. A Settings option controls the behavior; the owner chose
**"first terminal per tab" as the default**.

## Behavior

A three-mode app-global preference, `claudeAutoStart`:

- **`"first"` (default):** a terminal auto-runs `claude` only if no *other*
  terminal in its tab currently holds the tab's auto-Claude claim.
  Consequences:
  - Opening a project → its first terminal runs Claude.
  - `+` / split / agent-created terminals → plain shells.
  - Killing the auto-Claude terminal → the *next* new terminal in that tab
    auto-starts Claude again (the claim is released; the tab regains its
    session).
  - Opening a folder into a blank tab: the blank tab's scratch shell never
    held a claim (blank tabs are exempt, below), so the fresh folder-rooted
    terminal claims it → the project starts with Claude. A busy kept scratch
    shell keeps running untouched.
  - Only AUTO-started sessions are tracked. A manually-typed `claude` takes no
    claim, so an auto one may coexist with a manual one — accepted.
- **`"every"`:** every newly created project terminal auto-runs `claude`.
- **`"off"`:** terminals never auto-run anything.

**Project tabs only (all modes):** auto-start applies only when the terminal's
tab has a folder open (root non-null) — "in that project", literally. Blank
tabs' terminals always open as plain shells (run `claude` by hand in `$HOME`
if wanted). This also removes the launch race entirely: the only terminal that
can spawn before prefs hydrate is the launch blank tab's, and it is exempt;
project terminals are created by user interaction, long after hydration.

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

The decision happens at **pty-adoption time** (when the shell actually exists),
not at terminal-creation time: prefs hydrate asynchronously at launch, so a
creation-time flag could be stamped under the wrong mode. By adoption, project
terminals are always post-hydration (they require user interaction to exist).

| Unit | Responsibility |
| --- | --- |
| `store.ts` | `TabTerminals` gains `claudeAutoId: string \| null` — which terminal holds the tab's auto-Claude claim. New action `claudeAutoDecision(terminalId): boolean` does the whole decision atomically: resolve the owning tab; `off` or blank tab → false; `every` → true; `first` → claim `claudeAutoId` if free (or already ours) and return whether claimed. `removeTerminal` releases the claim when the holder dies. New app-global mirror `claudeAutoStart` + `setClaudeAutoStart`. Exports `CLAUDE_AUTO_COMMAND = "claude\n"`. |
| `TerminalPane.tsx` | In the `ptyCreate().then` adopt callback (after `setTerminalPty`): `if (claudeAutoDecision(terminalId)) ptyInput(id, CLAUDE_AUTO_COMMAND)`. One line of untested wiring (repo convention: thin electron wiring untested); all logic lives in the store action. The callback runs once per terminal (panes stay mounted via the keep-alive portal). |
| `shared/ipc.ts` + `main/prefs.ts` | `ClaudeAutoStart = "off" \| "first" \| "every"`; `AppPrefs.claudeAutoStart`; default `"first"`; sanitize: unknown value → default. |
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

- Store (`claudeAutoDecision`): `off` always false; blank tab always false;
  `every` true for project terminals; `first` claims once, denies the second
  terminal, re-grants after the holder is removed; claims are per-tab
  (two tabs each get one); the `openPickedFolder` blank-tab flow grants the
  fresh folder-rooted terminal.
- Prefs: defaults include `claudeAutoStart: "first"`; garbage sanitizes to
  `"first"`; valid values round-trip.
- `App.smoke.test.tsx`: only blank tabs exist there, which are exempt — the
  existing pty assertions stay deterministic by design; the typed
  DEFAULT_PREFS object gains the new field.

## Out of scope

- Configurable command/flags, per-project overrides, detecting an
  already-running Claude, retroactively starting/stopping sessions on mode
  change.
