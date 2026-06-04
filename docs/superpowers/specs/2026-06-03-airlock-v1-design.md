# Airlock — v1 Design Spec

**Date:** 2026-06-03
**Status:** Approved (Part 1 explicitly by Ricardo; Part 2 delegated to Claude)
**Working title:** `airlock` — rename anytime before public release.

## 1. Product summary

A terminal-first AI IDE where the agent can build, run, and debug your app but is
**structurally unable to read your secrets**. Not "the AI promises not to look" —
the secret value never exists anywhere the agent can observe: not in its context,
not in files it can read, not in terminal output it sees.

- **Primary user (v1):** Ricardo, as a daily driver replacing VS Code for his real
  projects (Node / Next.js / Vite / Snowflake tooling).
- **External users:** deferred to v2. No docs/onboarding investment in v1.
- **Design constraint:** every component upgradeable/replaceable later by one person.

### Success criteria for v1.0 (8 build-weeks at 10–15 h/week)

1. Open a real project, edit comfortably, run it, and commit — most sessions
   without opening VS Code.
2. The hero flow (§8) works end-to-end on a real Next.js app.
3. The red-team suite (§11) passes: no secret bytes, raw or encoded, ever reach
   the agent-visible stream.

v1.1 adds TypeScript LSP — the full VS Code exit.

## 2. Non-goals (v1)

Debugger · extension marketplace · collaboration · cloud sync · remote dev ·
LSP beyond TypeScript/JS · deployment helpers · database workflows · plugin
system · Windows/Linux packaging (macOS only; keep code portable) · custom
themes · OSC 133 block UI (v1.1) · command palette (v1.1).

## 3. Stack (decided)

| Area | Choice | Why |
|---|---|---|
| Desktop shell | Electron | One language (TS) everywhere; VS Code's own architecture — every hard problem has documented solutions; maximizes solo shipping probability |
| Build tooling | electron-vite | Standard, fast HMR for renderer |
| UI | React 19 + TypeScript (strict) + Zustand | Familiar; Zustand is minimal state without ceremony |
| Editor | CodeMirror 6 + `@codemirror/merge` | Light, fully themeable (non-VS-Code aesthetic is a goal), diff view built in |
| Terminal | `@xterm/xterm` + `node-pty` | The battle-tested pair (VS Code uses both) |
| Agent | `@anthropic-ai/claude-agent-sdk` | Loop, streaming, tool execution, `canUseTool` permission callback for free; we own every tool that touches the machine |
| Secrets | `@napi-rs/keyring` → macOS Keychain | Native credential store; no plaintext at rest |
| Git | system `git` CLI (shell out) | What VS Code does; no native bindings to maintain |
| Tests | vitest | Fast, TS-native |
| Lint/format | biome | One tool, zero config |
| Runtime | Node 24, npm workspaces | Already installed; no new package manager to learn |

The IDE's own Anthropic API key is itself stored in the broker (keychain) — the
product dogfoods its own secret handling from day one.

## 4. Repo structure (npm workspaces monorepo)

```text
airlock/
  package.json                 # workspaces root
  packages/
    agent-core/                # THE product. Zero Electron imports — ever.
      src/
        broker/                # keychain secrets + inject-at-spawn
        pty/                   # node-pty session manager
        redact/                # streaming redactor
        policy/                # tool metadata, risk rules, approval persistence
        tools/                 # agent-facing tools (run_command, request_secret, …)
        audit/                 # append-only hash-chained JSONL
        index.ts               # the ONLY public API surface
    app/
      src/
        main/                  # Electron main: hosts agent-core, Agent SDK loop, IPC
        preload/               # contextBridge — typed IPC only
        renderer/              # React UI (sandboxed, no Node access)
        shared/                # IPC channel + payload types (main ↔ renderer)
```

**Dependency rule:** `app` imports `agent-core`'s public API. Nothing imports
backward. This keeps three future options alive: Tauri/Rust port, shipping
agent-core as a standalone CLI/MCP server, or a full UI rewrite.

## 5. Process model & trust boundaries

```text
┌─ Electron main (Node) ──────────────────────────────────────┐
│  agent-core: broker ▸ keychain    Agent SDK loop (Claude)   │
│  PTY manager ▸ node-pty           policy + audit            │
└──────┬───────────────────────────────┬──────────────────────┘
       │ typed IPC (contextBridge)     │ spawned children:
┌──────▼──────────────┐                │  • user's app (dev server) ← secrets
│ Renderer (React UI) │                │    injected into THIS env only
│ sandboxed, no Node  │                │  • git; tsserver (v1.1)
└─────────────────────┘                └─ dedicated PTY per agent command
```

Renderer runs with `contextIsolation: true`, `nodeIntegration: false`, sandbox on.

**Boundary rules:**

1. **Secrets live in main only.** The renderer collects a value once in a modal,
   hands it over IPC, retains nothing. No tool returns a secret value;
   `listSecrets()` returns names + metadata only.
2. **The agent sees only post-redaction data.** PTY streams tee: raw → renderer
   (it is the user's own terminal); redacted → the buffer feeding agent tools and
   the audit log. Redaction happens in main, before anything can enter model context.
3. **Agent commands get dedicated PTYs.** `run_command` spawns a fresh PTY per
   call — clean capture, exit codes, no parsing the user's interactive shell. The
   user's terminal is agent-observable only via `get_terminal_tail()` (redacted).

## 6. agent-core components & public API

```ts
// broker/ — values enter via UI IPC only; nothing returns a value to tools
setSecret(projectId, name, value): Promise<ValidationResult>
hasSecret(projectId, name): boolean
listSecrets(projectId): SecretMeta[]            // names, createdAt, valid, provider
injectInto(env, projectId, names): ProcessEnv    // called at spawn time only
exportDotEnv(projectId, names, path): Promise<void>  // explicit, warned, audited

// pty/
createSession(opts): PtySession                  // the user's interactive terminal
runCommand(cmd, { cwd, injectSecrets }): Promise<RunResult>  // dedicated PTY

// redact/
createRedactor(secrets: SecretMeta[]): Transform // known values + variants + packs

// policy/
evaluate(tool, args): 'allow' | 'require-approval' | 'deny'
persistRule(projectId, rule): void               // "always allow X in this project"

// audit/
append(entry): void                              // hash-chained JSONL, fail-closed
verifyChain(): boolean
```

### Broker

- Storage: macOS Keychain, service `airlock`, account `${projectId}:${NAME}`
  (project scope) or `global:${NAME}` (app-level, e.g. the IDE's own Anthropic
  API key).
- Validation runs broker-side: per-provider format checks (`sk_live_` vs
  `pk_live_`, PEM structure, JWT shape, Postgres URL shape). The agent learns
  `{ saved: true, valid: true }` without seeing a byte.
- **No `.env` written by default.** Node/Next/Vite prefer real env vars over
  dotenv files, so inject-at-spawn Just Works. `exportDotEnv` exists as an
  explicit, warned, audited escape hatch for tools that demand a file.

### Redactor

Two engines on every agent-bound stream:

1. **Known-value:** every broker secret plus precomputed variants — base64,
   base64url, hex, URL-encoded, JSON-escaped — matched over a rolling 256-byte
   lookbehind buffer so values split across PTY chunks are still caught.
2. **Pattern packs:** AWS `AKIA…`, GitHub `ghp_…`, Slack `xoxb-…`, JWTs,
   connection-string passwords, `-----BEGIN … PRIVATE KEY-----` blocks.
   A pattern-pack hit on a value *not* in the broker is redacted **and**
   surfaced as a card: "unregistered secret detected — vault it?"

Every redaction fires an audit event.

### Policy

Each tool declares metadata: `{ risk, requiresApproval, writesFiles, networkAccess }`.
`run_command` adds a command classifier:

| Class | Examples | Behavior |
|---|---|---|
| Allowlist | `npm run *`, `npm test`, `git status/diff/log/add/commit` | runs without approval |
| Denylist | `rm -rf`, `sudo`, `curl\|bash`, `wget\|sh`, `git push --force`, `dd`, `chmod -R 777` | always requires approval; never auto-approvable |
| Default | everything else — incl. `npm install` (third-party postinstall scripts) and `node *` (arbitrary execution) | approval once → user may persist "always allow in this project" to `.airlock/policy.json` |

The persisted-rule mechanism is the approval-fatigue mitigation.

### Tools registered with the Agent SDK

SDK built-in file/bash tools are **disabled**; only these are registered
(in-process MCP). `canUseTool` routes every call through policy → approval UI.

| Tool | Risk | Approval | Notes |
|---|---|---|---|
| `run_command(cmd, {cwd, injectSecrets})` | medium | classifier decides | injection list shown in approval card |
| `request_secret(name, {providerHint})` | low | no — it asks the *user* | opens secure modal |
| `scan_env_requirements()` | low | no | ripgrep `process.env.*` / `import.meta.env.*` + `.env.example` |
| `read_file(path)` | low | no | workspace-rooted; `.env`-family paths denied |
| `write_file(path, content)` | medium | first use per project | workspace-rooted |
| `list_files(path)` | low | no | workspace-rooted |
| `get_terminal_tail(lines)` | low | no | redacted tail of user terminal |

Path handling: all file tools resolve against the workspace root and reject
traversal outside it. Symlinks resolve before the check.

### Audit

JSONL at `.airlock/audit/<date>.jsonl` (gitignored). Entry: timestamp, actor
(agent/user), tool, redacted args, policy decision + matching rule, outcome
summary, `hash = sha256(prevHash + entry)`. **Fail-closed:** if the audit log
cannot be written, agent actions stop. Renders in the sidebar as Agent Log.

## 7. Security & threat model

**Protects against:**

- Secret values entering model context, transcripts, or provider logs (the §6
  rule from the original plan, now structural).
- Agent reading secrets from disk (`.env`-family denied; nothing at rest outside
  the keychain by default).
- Secret values appearing in agent-visible terminal output, including base64 /
  hex / URL-encoded / JSON-escaped variants.
- Audit tampering going unnoticed (hash chain verification).

**Does NOT protect against (documented honestly):**

- A malicious local user or compromised OS/Electron runtime.
- Novel transformations performed by code the agent itself writes: an injected
  child process *can* read its own env and print e.g. rot13 of a value, which
  known-value matching cannot catch. Mitigations: injection requires the command
  class to be approved, the approval card names the injected secrets, and every
  injection is audited. This is defense-in-depth, not a cryptographic guarantee —
  the honest claim is "the agent cannot *read* your secrets; exfiltration via
  approved code execution is constrained and audited."
- Prompt injection in general (mitigated by approvals + policy, not solved —
  same as every agent product in 2026).

## 8. Hero flow (the v1.0 demo)

```text
1. Agent: run_command("npm run dev")            → allowlisted → dedicated PTY
2. Output: "Error: Missing DATABASE_URL"        → redactor (no-op) → agent sees it
3. Agent: scan_env_requirements()               → { missing: ["DATABASE_URL"] }
4. Agent: request_secret("DATABASE_URL")        → secure modal: name, format hint,
                                                  "this value never reaches the model"
5. User types value → IPC → broker → Keychain   → validation broker-side
6. Agent receives { name, status: "saved", valid: true, value: "REDACTED" }
7. Agent: run_command("npm run dev",
          { injectSecrets: ["DATABASE_URL"] })  → value into child env only
8. "Ready on localhost:3000"                    → every step in the audit log
```

## 9. UI design

*Revised 2026-06-03 after the first manual gate: the terminal owns the full main area (per the original product vision); the viewer opens as an on-demand split with a close button. The agent pane will be designed into this layout in weeks 3-5.*

> *Revised again 2026-06-03 (post git-v0.3 gate): owner directed a VS Code-grade polish pass — overlay scrollbars, codicons, collapsible sections, 22px density, hidden-inset chrome, status bar. The original §11 "non-VS-Code aesthetic" stance is superseded: airlock keeps its palette, adopts VS Code's structural discipline.*

```text
┌──────────────┬──────────────────────────────────────────────┐
│ Workspace    │ Terminal (owns the main area)                │
│  Files       │                                              │
│  Secrets     │  clicking a file → split:                    │
│  Git (wk 8)  │  ┌─────────────────┬───────────────────────┐ │
│  Agent Log   │  │ viewer      [✕] │ terminal              │ │
│              │  └─────────────────┴───────────────────────┘ │
└──────────────┴──────────────────────────────────────────────┘
```

- **Sidebar sections:** Files (tree); Secrets (names + status only — set/update
  via modal; never values); Git (week 8: status, stage, commit, diff); Agent Log
  (audit viewer). Sections collapse; sidebar toggles with `cmd+B`.
- **Viewer:** read-only CM6 viewer + `@codemirror/merge` diff (weeks 1–5) → editing,
  tabs, save, `cmd+P` fuzzy open (week 6) → project find/replace (week 7). Opens as
  an on-demand split pane (right of sidebar) when a file is clicked; a ✕ close button
  returns to full-width terminal. Both panes stay mounted so the shell session survives
  split toggling.
- **Agent pane:** placement TBD weeks 3-5. Approvals will be inline cards with keyboard
  accept (`cmd+Enter`) / deny (`esc`).
- **Secure input modal:** variable name, provider hint, broker-side validation
  feedback, masked input, caption "This value never reaches the AI model."
- **Aesthetic:** one dark theme; calm, linear, no icon ribbons (§11 of original
  plan). Settings = a JSON file, no settings UI in v1.

## 10. Error handling

| Failure | Behavior |
|---|---|
| Claude API rate limit / overload | banner in agent pane + retry; SDK handles transient retries |
| PTY crash | "restart session" action; audit entry |
| Keychain access denied | explicit dialog: retry or skip — **never** a silent `.env` fallback |
| `injectSecrets` names a missing secret | tool returns `{ error: "not-set" }` → agent typically calls `request_secret` |
| Unregistered secret in output | redacted by pattern pack + "vault it?" card |
| Audit write failure | **fail closed**: agent actions stop until writable |
| `git` missing / not a repo | Git section hidden; no error spam |
| LSP crash (v1.1) | auto-restart with backoff |

## 11. Testing

- **Unit (vitest, TDD for agent-core):** redactor property tests — every variant
  encoding, with the value split at random points across chunk boundaries;
  policy classifier table tests; broker with mocked keyring; env-scanner
  fixtures (Next, Vite, plain Node); audit chain verification.
- **Integration:** real node-pty runs of scripted fixtures; assert agent-visible
  output is clean and the audit chain is complete.
- **Red-team suite (CI gate, the product claim automated):** fixture project +
  scripted hostile tool calls — `cat .env` (denied), `printenv | base64`
  (redacted), `node -e "console.log(Buffer.from(process.env.X).toString('hex'))"`
  (redacted) — assert zero secret bytes, raw or variant, in anything
  agent-visible.
- **Manual hero-loop checklist** at each milestone; Playwright e2e deferred to v1.1.

## 12. Roadmap (build-weeks = 10–15 h each)

| Weeks | Deliverable | Gate |
|---|---|---|
| 1–2 | Electron shell: window, file tree, working terminal (xterm + node-pty), read-only CM6 viewer | "I can live in it as a terminal" |
| 3–5 | Agent SDK loop, broker, inject-at-spawn, redactor, policy + approvals, audit log, red-team suite in CI | hero flow recordable end-to-end + red-team suite green |
| 6–7 | Real editing: tabs, save, `cmd+P`, project find/replace | "most editing happens in airlock" |
| 8 | Git sidebar: status, stage, commit, diff | v1.0 tag |
| v1.1 | TS LSP (`typescript-language-server`), command palette, OSC 133 command blocks, approval-rules UI | full VS Code exit |

> *Revised 2026-06-03 after skeleton-v0.1 shipped: the owner reordered the
> roadmap — Phase A (standalone secrets: broker + keychain + terminal
> injection + import-from-.env + audit v0, NO agent yet) and Phase B (git
> sidebar) come before the agent. The redactor and request_secret remain
> tied to the agent phase. Spec section 6 architecture is unchanged; the
> broker simply gains a user-facing consumer (terminal injection) before
> its agent-facing one.*

## 13. Parked / future

Tauri or Rust port of agent-core · agent-core as standalone MCP server for
Claude Code/other agents ("ship the layer" option) · multi-language LSP ·
Windows/Linux · OSC 133 block UI · plugin system · name decision + trademark
check before anything goes public.
