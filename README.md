<div align="center">

# AirLock

### The multi-project, Claude-first IDE that can't leak your secrets.

[![Platform](https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon)-black)](#install)
[![License](https://img.shields.io/badge/license-source--available-blue)](LICENSE.md)
[![Release](https://img.shields.io/github/v/release/RicardoRamosT/Airlock-IDE?color=orange&label=release)](../../releases)
[![CI](https://github.com/RicardoRamosT/Airlock-IDE/actions/workflows/ci.yml/badge.svg)](https://github.com/RicardoRamosT/Airlock-IDE/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-2048-brightgreen)](#building-from-source)

<img src="docs/assets/hero.png" alt="AirLock: a split workspace with Claude Code running in each pane and the plan-usage gauges flanking the window title" width="800"/>

</div>

AirLock is a terminal-first IDE built around one idea: **your AI agent should
be able to build, run, debug, and deploy your app without ever being *able* to
read your credentials.** Claude Code is a first-class citizen of the IDE, every
project you're juggling lives in one window, and your secrets live in the macOS
Keychain behind a broker that injects them where they're needed and redacts
them everywhere else. Not "the agent promises not to look": **the tools to
look do not exist.** That is a claim about *reading the credential*, not a
sandbox — the [threat model](docs/threat-model.md#what-airlock-does-not-protect-against)
states plainly what it does and does not stop (redaction is value-based, so an
agent that deliberately encodes a secret can defeat it).

**Who this is for:** a developer or small team running coding agents against
real infrastructure, on macOS, who can't put production credentials in a `.env`
and can't watch every command the agent runs. If your agent only ever touches
toy data, you don't need this.

## Why AirLock

**Multi-project, for real.** Open every project you're working on at once: as
browser-style tabs in one window, side-by-side splits, or separate OS windows.
Each project keeps its own terminals, file tree, git view, secrets, and
databases alive in the background; switching tabs loses nothing. **Drag a project
tab out of the window** and it becomes its own window — or drop it onto another
AirLock window to merge it in — with its terminals still running: a live `claude`
keeps streaming, scrollback intact. Within a project, terminals, files, diffs,
and database tables open as tabs in the main area, and any two can be split side
by side (coexisting splits, a "scene" per tab).

**Claude-first, not Claude-bolted-on.** New project terminals auto-start
`claude` (configurable). Each project tab carries a live Claude status dot,
and glows when Claude finishes in a tab you aren't watching. Two usage gauges
flank the window title (your 5-hour and 7-day windows, colour-shifting as they
fill) and click through to a full per-session usage dashboard. And through a
local MCP bridge, the Claude in your terminal can **see and drive the IDE
itself**: 36 tools and a built-in manual (see below).

**Your secrets stay yours.** Credentials are vaulted in the macOS Keychain and
injected into terminals at spawn, so no `.env` ever sits on disk. The agent can
*use* a secret (run a migration against your `DATABASE_URL`) but never *see*
it: values are injected main-process-side and redacted out of every output that
reaches the agent — enforced by a
[source-level test](packages/app/src/main/mcp/tools.test.ts) that fails the build
if the MCP tool file even references a value-returning function. Commits are
scanned for leaked secret values before they land. Every broker operation is
hash-chain audited. **Where the line is:** this defends against a *confused*
agent and prompt injection, not a deliberately hostile one — redaction matches
values, so encoding defeats it, and a secret the agent may *use* is a secret it
may act with. The [threat model](docs/threat-model.md#what-airlock-does-not-protect-against)
is explicit about all of it. By design there are **no
third-party extensions**; the attack surface stays closed.

## How it compares

AirLock isn't trying to out-autocomplete your editor — it's a different shape,
aimed at running an AI agent across many projects without handing it your keys:

|                                                   | Claude Code (CLI) | VS Code / Cursor        | **AirLock**            |
| ------------------------------------------------- | :---------------: | :---------------------: | :--------------------: |
| Terminal-first AI agent                           |         ✓         | terminal + editor agent |           ✓            |
| Every project in one window, each its own agent   |         —         | one workspace at a time |    ✓ (tabs + splits)   |
| Many agents running at once                       |    ✓ (by hand)    |            —            |  ✓ (one per terminal)  |
| Agent can **use** a secret but **can't read** it  |         —         |            —            | ✓ (broker + redaction) [^1] |
| Agent can drive the IDE (tabs, splits, status)    |         —         |     via extensions      |   ✓ (built-in MCP)     |
| No third-party extensions (closed attack surface) |        n/a        | extension marketplace   |     ✓ (by design)      |
| Works on Linux / Windows                          |         ✓         |            ✓            | **— macOS, Apple Silicon** |
| Notarized, installs without a warning             |         ✓         |            ✓            | **— ad-hoc signed** [^2] |
| Works with agents other than Claude               |         —         |    ✓ (many, via ext.)   |  **— Claude-first**    |

[^1]: Reading is what's blocked, not misuse. Redaction matches known secret
    *values*, so an agent that deliberately encodes one can defeat it, and a
    credential the agent may *use* is one it may act with. See the
    [threat model](docs/threat-model.md#what-airlock-does-not-protect-against).

[^2]: No paid Apple Developer account yet, so first launch needs the one-time
    "Open Anyway" step. For a tool that asks you to trust it with credentials
    this is a real gap, not a footnote — it's the next thing on the list.

**Two categories this table does not cover, where AirLock is behind.**

*Agent orchestrators* isolate each agent in its own git worktree or container —
[Claude Squad](https://github.com/smtg-ai/claude-squad) does exactly this, with a
worktree and a tmux session per agent, across Claude Code, Codex, Gemini and
Aider. AirLock isolates by **project**, not by agent, so two agents on one repo
share a working tree. Worktree isolation is a *stronger* containment mechanism
than value redaction, and AirLock does not have it yet — which is worth saying
plainly on a tool that leads with security.

*Team secret platforms* (HashiCorp Vault and similar) do sharing, rotation,
environment separation and CI. The macOS Keychain is one machine and one human,
so a company cannot standardise on AirLock's vault today.

Last verified 2026-07-28. Only products checked against a primary source are
named here; others in both categories are known and being verified rather than
dismissed. This table decays — if a row is wrong, open an issue and it gets
fixed.

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
running. Right-click a tab and **Split with active project** puts two projects
side by side, each a full project view; the focused pane is what Claude and the
menus act on (**one agent at a time**, always on what you're looking at). Drag a
tab out of the window to **tear it off** into its own window, or onto another
AirLock window to merge it in — running terminals move with it, still alive.
Blank tabs (`⌘T`) give you a shell with no folder; opening a folder into one
keeps any running session alive. Prefer separate OS windows per project? Flip one
setting. Turn on **session restore** and your projects, tabs, and splits come
back on relaunch, each tab's Claude session resuming when you focus it. The
focused tab carries an inline **Overview** button: a generated dashboard of the
project's language/tech mix, README, live status, and a **Changelog** the agent
can write to as it works.

### Claude integration

- **Auto-start:** new project terminals run `claude` for you (`off` / once
  per tab / every terminal).
- **Status dots + glow:** see at a glance which project's Claude is working,
  and get a glow when one finishes in the background.
- **Plan usage gauges:** your account's 5h/7d windows as two bars flanking the
  window title -- always visible, even with the sidebar collapsed -- warming from
  blue through orange to red as each window fills, with reset countdowns on
  hover. Click either for the **Usage dashboard**: per-session and per-model API
  time, cost, lines changed, and context size.

### Claude can drive the IDE (MCP bridge)

AirLock runs a local MCP server (loopback-only, bearer-token-guarded) that the
Claude Code in its terminal connects to automatically. No extra setup, no
second API key. **36 tools**, and a built-in manual so the agent understands
the IDE without you explaining it:

- **See every status:** git, databases (reachability, never passwords), Neon,
  Docker, Render deploys, local dev-server health, CI for the current branch, your
  secret *names*, a project profile (`project_info`), the app's own event log
  (`read_events`), and its own **plan usage** (`plan_usage`).
- **Drive the layout:** open/close/switch project tabs, split views, spawn or
  kill terminals, type into a terminal (with your approval), and open the
  Settings/Usage pages. Ask "set up my workspace for this repo" and watch it
  happen.
- **Curate the sidebar:** show or hide sections to fit the project.
- **Keep a project journal:** record what changed in the project's **Changelog**
  as it works — one entry at a time, or a whole backfilled history in a single
  batched call — and revise its own notes later.
- **Pull in outside context:** read an issue from GitHub, or recent messages from
  the Slack channels *you* allow-listed (never the whole workspace).
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
(`.airlock/audit/log.jsonl`) — and **Audit ▸ Verify chain** re-walks it and tells
you whether it still holds, with the number of entries checked. An audit claim
you cannot check is decoration, so the check ships with it.

### Everything else in the sidebar

- **Git:** branch switcher, one-click stage/unstage, commit box, click-through
  unified diffs, right-click a change to stage/discard/open/copy, and undo the
  last commit. Push/pull/merge: the terminal is right there. **CI for the
  current branch** sits beside the branch switcher — the GitHub Actions run with
  its real step count, via `gh`. Honest progress only; nothing fakes a
  percentage.
- **Databases:** every `postgres-url` secret becomes a live connection (status
  dot via `SELECT 1`), expandable to tables, browsable in a read-only grid.
  Passwords never cross into the UI. A **Neon** group browses
  organizations → projects → branches → databases → tables, with a separate
  keychain-stored API key per project.
- **Docker:** machine-wide container list with live status and one-click
  start/stop.
- **Host:** your dev server's URL (configured or guessed from `package.json`)
  with a live up/down probe, plus **Render** and **Azure** service panels:
  Render deploy status and history with one-click redeploy (including whether
  your latest commit is the one that's live), and Azure Web App start/stop and
  Open in Portal.
- **GitHub accounts:** switch between every account `gh` knows, and **pin** one to
  a project so every push from that repo uses it — terminal, agent, or GUI —
  regardless of which account is globally active. Non-pinned projects can
  auto-switch on focus. A dot on the Accounts button tells you at a glance whether
  the account in play is the right one for the repo you're in.

- **Extensions:** a full-width page (not a sidebar panel) listing every
  integration grouped by real connection state — Connected / Not connected / Not
  installed / Disabled — with the actions that actually apply to each row and a
  detail pane per extension. Slack, GitHub, Neon, Render, Docker, Snowflake and
  Azure. There is deliberately no marketplace: these are first-party adapters,
  and the list is the whole of it.

Each section shows only when you want it (right-click → Hide, or
**View ▸ Sidebar**), and Claude can curate this for you. An activity-bar rail
switches sections and shows a per-section health dot at a glance. Dark and light
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

Early and moving fast: v0.6.1, built and dogfooded daily (AirLock is developed
inside AirLock, by the Claude it hosts). Expect rough edges; the security
invariants are the part that's tested hardest — 2,048 unit tests, including the
[source-level guard](packages/app/src/main/mcp/tools.test.ts) that fails the
build if the MCP tool file so much as references a value-returning function.

## FAQ

**Why macOS only?** AirLock leans hard on macOS-native pieces — the Keychain
for the secret vault, login-shell environment capture, and Apple-Silicon
packaging. A cross-platform port is possible but isn't the focus while the
security model is being hardened.

**Why source-available, not open source?** You can read every line — the
security claims are only credible if you can verify them — but redistribution
and modification aren't permitted, so there is one canonical, auditable build of
a tool people trust with credentials. A forked AirLock with an altered secret
broker would carry the name without the guarantees. It is deliberately not an
OSI license, and that has a real cost: the programmes that fund free security
audits for open-source projects are closed to AirLock.

**Can I use it at work?** Not under the default license — that one is
noncommercial. Commercial use needs a separate grant over the same source; see
[COMMERCIAL.md](COMMERCIAL.md).

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

AirLock is **source-available, not open source**, and **dual-licensed**.
Copyright © 2026 Ricardo Ramos Treviño.

- **Default:** [PolyForm Strict License 1.0.0](LICENSE.md). Read every line, and
  use it for any noncommercial purpose — personal study, hobby projects,
  research, and use by charities, schools, public research bodies and government.
  Modification and redistribution are not permitted under either grant.
- **Commercial use** — including a developer at a company running AirLock on
  that company's code — needs a separate licence. See
  [COMMERCIAL.md](COMMERCIAL.md).

Same source either way; only the grant differs.

Third-party dependencies are used under their own permissive licenses
(MIT/BSD/ISC/Apache and similar); their notices ship with the packaged app.
