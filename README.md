<div align="center">

# AirLock

### The multi-project, Claude-first IDE that can't leak your secrets.

[![Platform](https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon)-black)](#install)
[![License](https://img.shields.io/badge/license-source--available-blue)](LICENSE.md)
[![Release](https://img.shields.io/github/v/release/RicardoRamosT/Airlock-IDE?color=orange&label=release)](../../releases)
[![CI](https://github.com/RicardoRamosT/Airlock-IDE/actions/workflows/ci.yml/badge.svg)](https://github.com/RicardoRamosT/Airlock-IDE/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-690%2B-brightgreen)](#building-from-source)

<img src="docs/assets/hero.png" alt="AirLock: a split workspace with Claude Code running in each pane and the plan-usage meter in the sidebar" width="800"/>

</div>

AirLock is a terminal-first IDE built around one idea: **your AI agent should
be able to build, run, debug, and deploy your app without ever being *able* to
read your credentials.** Claude Code is a first-class citizen of the IDE, every
project you're juggling lives in one window, and your secrets live in the macOS
Keychain behind a broker that injects them where they're needed and redacts
them everywhere else. Not "the agent promises not to look": **the tools to
look do not exist.**

## Why AirLock

**Multi-project, for real.** Open every project you're working on at once: as
browser-style tabs in one window, side-by-side splits, or separate OS windows.
Each project keeps its own terminals, file tree, git view, secrets, and
databases alive in the background; switching tabs loses nothing. Within a
project, terminals, files, diffs, and database tables open as tabs in the main
area, and any two can be split side by side (coexisting splits, a "scene" per
tab).

**Claude-first, not Claude-bolted-on.** New project terminals auto-start
`claude` (configurable). Each project tab carries a live Claude status dot,
and glows when Claude finishes in a tab you aren't watching. A plan-usage meter
sits in the sidebar (your 5-hour and 7-day windows, with session/weekly reset
countdowns) and clicks through to a full per-session usage dashboard. And
through a local MCP bridge, the Claude in your terminal can **see and drive
the IDE itself**: 25 tools and a built-in manual (see below).

**Your secrets stay yours.** Credentials are vaulted in the macOS Keychain and
injected into terminals at spawn, so no `.env` ever sits on disk. The agent can
*use* a secret (run a migration against your `DATABASE_URL`) but never *see*
it: values are injected main-process-side and redacted out of every output that
reaches the agent. Commits are scanned for leaked secret values before they
land. Every broker operation is hash-chain audited. By design there are **no
third-party extensions**; the attack surface stays closed.

## How it compares

AirLock isn't trying to out-autocomplete your editor — it's a different shape,
aimed at running an AI agent across many projects without handing it your keys:

|                                                   | Claude Code (CLI) | VS Code / Cursor       | **AirLock**            |
| ------------------------------------------------- | :---------------: | :--------------------: | :--------------------: |
| Terminal-first AI agent                           |         ✓         | terminal + editor agent |           ✓            |
| Every project in one window, each its own agent   |         —         | one workspace at a time |    ✓ (tabs + splits)   |
| Agent can **use** a secret but **can't read** it  |         —         |           —            |  ✓ (broker + redaction) |
| Agent can drive the IDE (tabs, splits, status)    |         —         |     via extensions     |   ✓ (built-in MCP)     |
| No third-party extensions (closed attack surface) |        n/a        |   extension marketplace |     ✓ (by design)      |

It pairs *with* Claude Code rather than replacing it: AirLock hosts the same
`claude`, and adds the multi-project shell, the secret broker, and the MCP
bridge that lets Claude see and drive the workspace.

## Install

**[Download the latest DMG from Releases](../../releases)** (macOS, Apple
Silicon), open it, and drag **AirLock** into **Applications**.

First launch: macOS will say it *"could not verify AirLock is free of
malware"*, because AirLock is ad-hoc signed, not notarized (no $99 Apple
Developer account). One-time fix: **System Settings → Privacy & Security →
"Open Anyway"**, or in a terminal: `xattr -cr /Applications/AirLock.app`.

For the full Claude experience, have [Claude Code](https://claude.com/claude-code)
installed; AirLock auto-detects it.

## The tour

### Terminals own the main area

A full multi-terminal panel: tabs (`+` to spawn, double-click to rename; a
manual rename pins the title against the shell's auto-titles), side-by-side
splits, and buffers that survive tab switches because background terminals are
never torn down. Each terminal inherits your login-shell `PATH`/locale, so
Homebrew tools work even when AirLock is launched from Finder.

### Projects: tabs, windows, splits

A project strip shows one tab per open project; the file tree, git, secrets,
and the agent all follow the active tab while every tab's terminals keep
running. The **split** button puts two projects side by side, each a full
project view; the focused pane is what Claude and the menus act on (**one
agent at a time**, always on what you're looking at). Blank tabs (`⌘T`) give
you a shell with no folder; opening a folder into one keeps any running
session alive. Prefer separate OS windows per project? Flip one setting.

### Claude integration

- **Auto-start:** new project terminals run `claude` for you (`off` / once
  per tab / every terminal).
- **Status dots + glow:** see at a glance which project's Claude is working,
  and get a glow when one finishes in the background.
- **Plan usage meter:** your account's 5h/7d windows with live reset
  countdowns, pinned in the sidebar; click for the **Usage dashboard** with
  per-session and per-model API time, cost, lines changed, and context size.

### Claude can drive the IDE (MCP bridge)

AirLock runs a local MCP server (loopback-only, bearer-token-guarded) that the
Claude Code in its terminal connects to automatically. No extra setup, no
second API key. **25 tools**, and a built-in manual so the agent understands
the IDE without you explaining it:

- **See every status:** git, databases (reachability, never passwords), Neon,
  Docker, Render deploys, local dev-server health, the live Activity feed, your
  secret *names*, and its own **plan usage** (`plan_usage`).
- **Drive the layout:** open/close/switch project tabs, split views, spawn or
  kill terminals, open the Settings/Usage pages. Ask "set up my workspace for
  this repo" and watch it happen.
- **Curate the sidebar:** show or hide sections to fit the project; dismiss
  finished Activity entries.
- **Act with your secrets, blindly:** `run_command` injects named vaulted
  secrets into one command's environment and **redacts the values from the
  output**; `git_commit` scans staged content and **blocks commits that contain
  a secret value**; `request_secret` pops a secure prompt so *you* vault what
  it needs; `get_terminal_tail` reads terminal output with every vaulted value
  redacted.

**The boundary:** a test-enforced allowlist locks the tool set. No tool
returns a secret value, ever, and a tool that could fails the build. Claude
Code asks for your approval on first use; nothing happens behind your back.

### Secrets

Vaulted in the macOS Keychain, scoped per project. `Import .env` migrates an
existing file (deleted only after every entry vaults cleanly). Injection
happens at terminal spawn; loader-hijack names (`PATH`, `DYLD_*`,
`NODE_OPTIONS` and friends) are stripped and audited. You (the human) can
reveal or copy a value from the sidebar; the clipboard auto-clears. Every
broker operation lands in a hash-chained audit log
(`.airlock/audit/log.jsonl`).

### Everything else in the sidebar

- **Git:** branch switcher, one-click stage/unstage, commit box, click-through
  unified diffs. Push/pull/merge: the terminal is right there.
- **Databases:** every `postgres-url` secret becomes a live connection (status
  dot via `SELECT 1`), expandable to tables, browsable in a read-only grid.
  Passwords never cross into the UI. A **Neon** group browses
  projects → branches → databases with a keychain-stored API key.
- **Docker:** machine-wide container list with live status and one-click
  start/stop.
- **Host:** your dev server's URL (configured or guessed from `package.json`)
  with a live up/down probe, plus **Render** deploy status including whether
  your latest commit is the one that's live.
- **Activity:** a live feed of in-progress work: GitHub Actions runs (with a
  real step checklist, via `gh`), Render deploys mid-build, containers
  starting. Honest progress only; nothing fakes a percentage.
- **GitHub accounts:** switch between every account `gh` knows, with a warning
  when the active account doesn't match the repo's commit identity.

Each section shows only when you want it (right-click → Hide, or
**View ▸ Sidebar**), and Claude can curate this for you. Dark and light
themes; sidebar left or right.

## Building from source

```bash
npm install
npm run rebuild    # rebuild node-pty for Electron's ABI
npm run dev        # launch the dev app
npm test           # agent-core + renderer unit tests (vitest)
npm run typecheck
npm run lint
npm run package    # unpacked .app for local daily use
npm run dist:mac   # shareable DMG -> packages/app/release/
```

macOS only, by design.

## Status

Early and moving fast: **v0.3.0**, built and dogfooded daily (AirLock is
developed inside AirLock, by the Claude it hosts). Expect rough edges; the
security invariants are the part that's tested hardest (690+ unit tests,
including source-level guards on the no-secret-value rule).

## FAQ

**Why macOS only?** AirLock leans hard on macOS-native pieces — the Keychain
for the secret vault, login-shell environment capture, and Apple-Silicon
packaging. A cross-platform port is possible but isn't the focus while the
security model is being hardened.

**Why source-available, not open source?** You can read every line — the
security claims are only credible if you can verify them — but the license
forbids redistribution, modification, and commercial use. It's a deliberate
choice to keep one canonical, audited build of a security-sensitive tool, not
an OSI open-source license. See [License](#license).

**Does Claude ever see my secret values?** No — that's the core invariant.
Secrets live in the Keychain; values are injected into a command's environment
main-process-side and redacted from every output the agent can read (terminal
tails, command output). The MCP tool set is an allowlist with a test that fails
the build if any tool could return a secret value. Claude *uses* secrets but
can't *read* them — the [threat model](docs/threat-model.md) spells out exactly
where that line is (and isn't).

**Is the download notarized?** Not yet — the release is ad-hoc signed (no paid
Apple Developer account), so first launch needs the one-time "Open Anyway" step
in [Install](#install).

**Can I contribute code?** The license doesn't permit outside modifications, so
code PRs aren't accepted — but issues, bug reports, and feature ideas are very
welcome. See [CONTRIBUTING](CONTRIBUTING.md).

## Credits

Icons: [@vscode/codicons](https://github.com/microsoft/vscode-codicons) (CC-BY-4.0).

## License

AirLock is **source-available, not open source**. Copyright © 2026 Ricardo
Ramos Treviño. Licensed under the
[PolyForm Strict License 1.0.0](LICENSE.md): you may read the source and use
the software for noncommercial purposes, but **modification, redistribution,
and commercial use are not permitted**. For a commercial or other license,
contact the author ([@RicardoRamosT](https://github.com/RicardoRamosT)).

Third-party dependencies are used under their own permissive licenses
(MIT/BSD/ISC/Apache and similar); their notices ship with the packaged app.
