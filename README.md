# airlock

> Working title. A terminal-first AI IDE where the agent can build, run, and
> debug your app — but is structurally unable to read your secrets.

**Status:** skeleton + secrets + git. A multi-terminal panel (tabs, split,
rename), file tree, viewer split, keychain secrets with terminal injection,
hash-chained audit, and a live git sidebar (stage/commit/branch/diffs) all
work. The agent phase is next.

Spec: `docs/superpowers/specs/2026-06-03-airlock-v1-design.md`

## Dev

```bash
npm install
npm run rebuild   # rebuild node-pty for Electron's ABI
npm run dev       # launch the app
npm test          # agent-core + renderer unit tests
npm run typecheck
npm run lint
```

macOS only for now (by design — see spec §2).

## Package (real airlock.app for daily use)

```bash
npm run package   # → packages/app/release/mac-arm64/airlock.app
```

Drag it to /Applications (or the dock). Unsigned — local use only.
Note: in `npm run dev` the dock may still show "Electron" (the dev binary's
identity); the packaged app shows the airlock name + icon everywhere.
To rebrand: replace `packages/app/build/icon.svg`, run
`bash packages/app/scripts/make-icon.sh`, re-package.

## Terminal

The terminal owns the main area and is a full multi-terminal panel:

- **Tabs** — `+` spawns a new terminal; click a tab to switch; `✕` kills it
  (closing the last tab respawns a fresh one). Tab titles track the running
  process via the shell's OSC title sequences.
- **Rename** — double-click a tab to name it; a manual rename pins the title so
  later OSC updates stop overwriting it.
- **Split** — show two shells side-by-side; the split button toggles it off.
- **Layout** — a top-right cluster in the title bar shows/hides the sidebar and
  flips it (left ⇄ right); both are remembered across launches. To go
  terminal-only, hide the sidebar and close the viewer with its ✕.

Every terminal stays alive in the background, so buffers survive tab switches.
Secrets are injected at spawn, so they apply to **new** terminals only — after
toggling injection, the secrets panel offers a "restart active" hint that
replaces just the active terminal with a freshly injected one (other running
terminals keep their existing env).

## Secrets

Secrets live in the macOS Keychain (service `airlock`), scoped per project.
Add them in the sidebar, or `Import .env` to vault an existing file (it is
deleted after import only when every entry vaulted cleanly). Toggle "inject
into terminal" and new terminal sessions receive them as env vars — no
`.env` on disk, ever. Loader-hijack names (PATH, DYLD_*, NODE_OPTIONS...)
are stripped at the spawn site and audited. Every broker operation lands
in `.airlock/audit/log.jsonl`, hash-chained.

Secrets only reach **new** terminals (injected at spawn), and each terminal
inherits your login-shell `PATH`/locale — so homebrew tools and `LANG` work
even when Airlock is launched from Finder.

Note: the packaged app is ad-hoc signed; after re-packaging, macOS may
re-prompt Keychain access once per rebuild ("airlock wants to access...").
Click Always Allow. A real signing identity would make this stick.

## Git

The sidebar shows the current branch (switch or create from the dropdown),
staged/unstaged changes with one-click stage/unstage, and a commit box.
Click any changed file for a unified diff in the viewer split. Push, pull,
merge, and anything else: the terminal is right there.

## Credits

Icons: [@vscode/codicons](https://github.com/microsoft/vscode-codicons) (CC-BY-4.0).
