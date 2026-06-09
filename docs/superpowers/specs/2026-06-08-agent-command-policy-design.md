# Agent Command Policy -- Design

**Date:** 2026-06-08
**Status:** Approved (pending spec review)
**Phase:** 3 (Safety moat), **sub-project 3 of 3** (agent sandboxing), **slice 1 of N**.

## Goal

Bound what the AI agent can *do* through `run_command` with a **user-configurable
policy**: classify each command by what it touches, and per category apply the
user's choice of **Allow / Ask / Block**. "Ask" rides through the agent (re-call
with `confirm`), never an IDE modal. This is enforcement the agent can't
self-grant -- the first slice of agent sandboxing. (Sub-project 2, dependency
scanning, was dropped: it was advisory and Claude already covers it.)

## Decisions

1. **Per-category policy, user-configurable.** Four risk categories; each is
   `Allow | Ask | Block` in an **Agent** settings panel. The user encodes intent
   (a wanted `rm -rf` vs an unwanted one can only be told apart by the user).
2. **Defaults:** `network: Allow`, `outsideWorkspace: Ask`, `destructive: Ask`,
   `privilege: Block`. Safe but not annoying -- normal in-project dev + installs
   flow freely; only the genuinely dangerous classes gate.
3. **"Ask" = agent-confirm** (same pattern as `git_commit`): a gated command
   returns `{ blocked: true, action: "ask", categories, reason }`; the agent tells
   the user and re-calls `run_command` with `confirm: true`. **"Block" is
   absolute** -- `confirm` does NOT override it.
4. **Strictest-wins:** a command hitting several categories takes the strictest
   action among them (`block` > `ask` > `allow`); no category hit -> `allow`.
5. **Heuristic classification (honest v1 limit):** categories are inferred by
   reading the command string -- reliable for the obvious dangerous patterns
   (which is most prompt-injection), but a deliberately obfuscated command can
   evade the string check. Airtight OS-level isolation is a later slice.
6. **The gate lives main-side** (reads the persisted policy + calls `runCommand`);
   the classifier + decision are pure (agent-core), so they unit-test cleanly.

## Non-goals (this slice)

- OS-level enforcement (`sandbox-exec` / namespaces / seccomp), a real network
  egress firewall, and scoping the agent's *file* IPC -- later slices of
  sub-project 3.
- Obfuscation-proof classification (base64'd commands, `node evil.js`, etc.) --
  the string heuristic catches the obvious; deep isolation is the later answer.
- Per-command allow/deny lists, per-project policy overrides, "always allow this
  exact command" memory -- v1 is the four-category global policy. (Future.)
- Gating anything other than `run_command` (the file tools already use
  `resolveWithin`; the commit path has its own gate).

## Architecture

### agent-core -- classifier + decision (pure, unit-tested)

New `packages/agent-core/src/command/policy.ts`:

```ts
export type RiskCategory =
  | "network"          // curl/wget/nc/ssh/scp/... -- reaches off-machine
  | "outsideWorkspace" // ~, $HOME, abs paths outside root, .. escapes -- cred/exfil path
  | "destructive"      // rm -rf, git push --force, git reset --hard, dd, mkfs, shred
  | "privilege";       // sudo, doas, pkexec, su

export type RiskAction = "allow" | "ask" | "block";
export type AgentCommandPolicy = Record<RiskCategory, RiskAction>;

export const DEFAULT_AGENT_POLICY: AgentCommandPolicy = {
  network: "allow",
  outsideWorkspace: "ask",
  destructive: "ask",
  privilege: "block",
};

// Heuristic: which risk categories does this command string touch?
export function classifyCommand(command: string): RiskCategory[];

// Strictest action among the matched categories (block > ask > allow); none -> allow.
export function decideCommand(
  command: string,
  policy: AgentCommandPolicy,
): { action: RiskAction; categories: RiskCategory[] };
```

`classifyCommand` uses representative patterns per category (e.g. privilege:
`\b(sudo|doas|pkexec|su)\b`; destructive: `rm` with `-r`/`-f`, `git push
--force|-f`, `git reset --hard`, `git clean -fd`, `dd|mkfs|shred|truncate`;
network: `\b(curl|wget|nc|ncat|telnet|ssh|scp|sftp|ftp)\b`; outsideWorkspace:
a leading `~`/`$HOME`, an absolute path, or a `..` segment). Pure, no I/O.

### main -- persisted policy + the gate

- **prefs** (`packages/app/src/main/prefs.ts`): persist `agentPolicy:
  AgentCommandPolicy` alongside `sectionVisibility`, defaulting to
  `DEFAULT_AGENT_POLICY` (merge on load so a new category gets its default).
- **IPC** (`ipc.ts` + preload + `AirlockApi`): `getAgentPolicy(): Promise<AgentCommandPolicy>`
  and `setAgentPolicy(p: AgentCommandPolicy): Promise<void>` (renderer settings
  panel reads/writes; persisted via savePrefs).
- **The gate** is applied in the `run_command` MCP tool: read the current policy,
  `decideCommand(command, policy)`, then:
  - `block` -> return `{ blocked: true, action: "block", categories, reason }`
    (never runs; `confirm` ignored).
  - `ask` + `!confirm` -> return `{ blocked: true, action: "ask", categories, reason }`.
  - otherwise -> `runCommand(...)` as today (output redacted by the broker layer).
  Gated/blocked decisions are written to the audit chain (`appendAudit`) -- a
  record of what the agent tried, names/categories only, no command-value
  surprises (the command text is the agent's own input, not a secret).

### IPC / shared types (`shared/ipc.ts`, ASCII)

```ts
export interface CommandGateBlock {
  blocked: true;
  action: "ask" | "block";
  categories: RiskCategory[];
  reason: string; // human-readable, e.g. "touches files outside the project"
}
```

`run_command` returns `AgentCommandResult` (unchanged) when allowed, or
`CommandGateBlock` when gated. `RiskCategory`/`RiskAction`/`AgentCommandPolicy`
are re-exported from `@airlock/agent-core` through `shared/ipc.ts`.

### MCP tool (`mcp/tools.ts`)

`run_command` gains `confirm: z.boolean().optional()` in its input schema and
routes through the gate (reading the policy via a `deps.getAgentPolicy()` the
registrar provides). The tool count + allowlist are unchanged (no new tool); the
description notes the gate + the `confirm` re-call. The CI source guard is
untouched (no value-accessors involved).

### renderer -- the Agent settings panel

A new sidebar section **"Agent"** (`AgentSection.tsx`), gated by visibility like
the others: four rows (Network / Outside the project / Destructive / Privilege),
each a `Allow | Ask | Block` selector bound to `getAgentPolicy`/`setAgentPolicy`.
Adding the section touches the usual spots: `Section` union (`shared/ipc.ts`),
`SECTIONS` + `DEFAULT_SECTION_VISIBILITY` (`prefs.ts`), `SECTION_LABELS`
(`menu.ts`), and one line in `Sidebar.tsx`.

## Data flow

Agent calls `run_command(cmd)` -> tool reads policy -> `decideCommand`:
- allow -> `runCommand` -> redacted output.
- ask + no confirm -> `{ blocked, action: "ask", categories, reason }` -> agent
  surfaces it ("this deletes files outside the project -- ok?") -> re-calls with
  `confirm: true` -> runs.
- block -> `{ blocked, action: "block", ... }` -> agent reports it can't; the
  user must change the policy in Agent settings to proceed.
Human edits Agent settings -> `setAgentPolicy` -> persisted -> next decision uses it.

## Error handling

- Classification + decision are pure and total; an unrecognized command matches
  no category -> `allow` (never a spurious block).
- If the persisted policy can't be loaded, fall back to `DEFAULT_AGENT_POLICY`
  (safe defaults) -- never "allow everything."
- `block`/`ask` outcomes carry a plain-language `reason` so the agent can explain
  it to the user.

## Testing

- `classifyCommand` units: each category's representative patterns hit; safe
  commands (`ls`, `npm test`, `git status`) match nothing; case/flag variants.
- `decideCommand` units: strictest-wins across multiple categories; no-match ->
  allow; each policy action maps correctly.
- Gate behavior (mockable): `block` never runs (even with confirm); `ask` without
  confirm blocks, with confirm runs; `allow` runs; the policy is read fresh.
- prefs round-trip: `setAgentPolicy`/`getAgentPolicy` persist + merge defaults.
- Headless MCP probe (run_command with a destructive command -> blocked, then
  confirm -> runs; sudo -> blocked regardless) + manual gate of the Agent panel.

## Constraints

- ASCII-only in `agent-core/**` (policy.ts), `main/**`, `shared/ipc.ts`,
  `preload/index.ts`, `mcp/tools.ts` (CJS bundling -- use `--`).
- Reuses: `runCommand` (unchanged), the prefs persist/IPC pattern
  (`sectionVisibility`), the `git_commit` confirm-gate pattern, the sidebar
  Section pattern, `appendAudit`.
- No new runtime dependency.
