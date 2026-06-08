# AirLock Roadmap -- to "the safest daily-driver IDE"

**North star:** the IDE you daily-drive *because* it is the safest. Capabilities
are built-in, pinned, and vetted -- there is **no plugin host** and the AI agent
is **secret-blind** (the inject-at-spawn broker means it structurally cannot read
secret values). "Replace VS Code" here means "be the secure alternative I reach
for first," not feature-parity with its marketplace.

**Guiding rule:** an unused secure IDE secures nothing. Make AirLock *livable*
and *intelligent* first, then make that daily-driver uniquely safe. The one cheap
exception -- secret-leak detection -- is on-brand and slots in early.

---

## Phase 0 -- where we are (DONE)

Editor (CodeMirror: highlight, in-file find/replace, multi-cursor, fold, undo,
basic autocomplete), full file management (tree + create/rename/trash/duplicate/
move/reorder + live watcher + open-tab sync), terminals (xterm + node-pty, tabs),
multi-split "scene" model, multi-window, git (status/stage/commit/branch/diff),
GitHub account, **secret broker + reveal + .env import**, **audit chain**, DBs
(local + Neon), Docker, Host/Render/localhost, Activity panel, section
visibility, settings, themes, and the **local MCP server** (agent IDE-control +
request_secret). The built-in panels already put AirLock *ahead* of VS Code for
this workflow.

---

## The two tracks

- **Parity** -- built-in editor/navigation features so it is pleasant to live in.
  Delivered first-party and vetted; never a marketplace.
- **Moat** -- affirmative-security features that are the actual reason to switch.
  This is the identity, not an add-on.

Effort legend: **S** = days, **M** = ~1 week, **L** = multi-week.

---

## Phase 1 -- "Navigable" (parity quick wins)

Removes the highest daily friction. After this, navigation and git stop sending
you back to VS Code.

| Feature | Track | Effort | Notes / dependencies |
|---|---|---|---|
| Fuzzy-modal foundation | parity | S | Shared infra for the next two; build once |
| Quick-open (Cmd+P) | parity | S | Jump to any file by name; on the modal infra |
| Command palette (Cmd+Shift+P) | parity | S | Keyboard-driven actions; on the modal infra (a TODO already exists in `SettingsMenu`) |
| Project search (find-in-files) | parity | M | Bundled ripgrep (or Node scan) IPC + a results panel |
| Git sync in the UI | parity | S | push/pull/fetch buttons over the existing git plumbing (no IPC for sync today) |

**Exit criteria:** find anything (file or text), run any action by keyboard, and
sync git without dropping to the terminal.

---

## Phase 2 -- "Intelligent" (the IDE-feel centerpiece)

The single biggest "text editor -> IDE" lever. Biggest build; its own milestone.

| Feature | Track | Effort | Notes / dependencies |
|---|---|---|---|
| LSP (TypeScript first) | parity | **L** | Bundled `typescript-language-server`; JSON-RPC over stdio in main + a CodeMirror LSP client: completions, hover, **inline type errors**, go-to-definition, rename. A bundled server is fine under the safety rule -- own process, pinned, and secret-blind (the broker holds) |
| Problems panel | parity | S | Falls out of LSP diagnostics for free |
| Format / format-on-save | parity | S-M | Bundled Biome/Prettier; first-party, not a plugin |

**Exit criteria:** completions, red-squiggle type errors, go-to-def, and
format-on-save for TS/JS. After this, the only thing VS Code does clearly better
for most web work is debugging.

---

## Phase 3 -- "The moat" (the why-switch)

The features no other IDE has. Most valuable once you are actually doing real
work in AirLock (Phases 1-2), which is when these threats go live. Secret-leak
detection is cheap and on-brand enough to pull forward into Phase 1 if desired.

| Feature | Track | Effort | Notes / dependencies |
|---|---|---|---|
| Secret-leak detection | moat | M | Warn before a secret-looking value lands in a file, a commit, or terminal output -- extends the broker philosophy to the whole workflow |
| Dependency / supply-chain scanning | moat | M | Malicious npm is the no-extension IDE's equivalent threat: flag known-vuln + typosquatted packages on install (npm audit / OSV) |
| Agent sandboxing + egress limits | moat | M-L | The AI agent is the biggest execution surface: confine what it runs and where it can phone home; architectural, builds on the MCP/terminal layer |

**Exit criteria:** AirLock actively prevents the leak/supply-chain/agent-exfil
classes of incident -- the marketing claim "the safest IDE" becomes demonstrable.

---

## Phase 4 -- "Complete" (heavyweight + polish)

| Feature | Track | Effort | Notes |
|---|---|---|---|
| Debugger (DAP) | parity | **L** | Debug Adapter Protocol, analogous to LSP; the last big parity piece. Workflow-dependent -- deferrable if you live on `console.log` + terminal |
| More LSP languages (Python, etc.) | parity | M each | Repeat the Phase 2 client per language server |
| Polish: breadcrumbs, git blame, minimap | parity | S each | Feel, not function |

---

## The judgment call: moat timing

Tempting to do the moat first (it is the identity). The pragmatic call is
**livable -> intelligent -> moat**, because you will not daily-drive AirLock for
real work until Phases 1-2 land, and the moat protects real work. The exception:
**secret-leak detection** is cheap, on-brand, and protective immediately -- pull
it into Phase 1 as the early moat win if you want a safety beat sooner.

## Honest bottom line

~**3 substantial milestones** to a real daily driver: Phase 1 (navigable),
Phase 2 (LSP), and at least secret-leak detection from Phase 3. Dependency
scanning + agent sandboxing complete the moat; the debugger is the only true
heavyweight you can defer indefinitely.

## Execution approach

Per the hybrid preference: gnarly tasks on Opus directly (the CodeMirror LSP
client, JSON-RPC plumbing, DAP, agent sandboxing); mechanical, well-specified
tasks via subagents. Each phase feature gets the brainstorm -> spec -> plan ->
build -> review -> gate cycle.

## Recommended immediate next step

Phase 1, starting with the **fuzzy-modal foundation -> Cmd+P quick-open +
command palette** (one small shared build, two features), then project search,
then git-sync buttons.
