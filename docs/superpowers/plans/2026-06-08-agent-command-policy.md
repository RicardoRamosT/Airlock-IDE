# Agent Command Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the agent's `run_command` by a user-configurable per-category policy (Allow / Ask / Block), with Ask riding through the agent (confirm) and Block absolute.

**Architecture:** A pure classifier + gate (agent-core) tags a command's risk categories and resolves the policy + confirm to run-or-block; the policy persists in prefs; the `run_command` MCP tool reads the policy and applies the gate (auditing blocks); an Agent sidebar panel edits the policy.

**Tech Stack:** TypeScript, Electron, MCP (@modelcontextprotocol/sdk), vitest, biome.

**Spec:** `docs/superpowers/specs/2026-06-08-agent-command-policy-design.md`

**Refinement vs spec:** the `run_command` tool reads the policy via `loadPrefs(deps.prefsFile)` (the tool already receives `prefsFile`), so no new `deps` field is threaded. The pure gate decision (`gateCommand`) lives in agent-core and is fully unit-tested; the tool is a thin executor.

**Execution (hybrid):** Tasks 1-2 are pure/mechanical -> subagents. Tasks 3 (the security gate) and 4 (the settings UI) -> implement on Opus.

---

## File Structure

- Create `packages/agent-core/src/command/policy.ts` -- classifier + gate + types + default.
- Create `packages/agent-core/src/command/policy.test.ts`.
- Modify `packages/agent-core/src/index.ts` -- export the policy API.
- Modify `packages/app/src/shared/ipc.ts` -- re-export policy types; `AppPrefs.agentPolicy`; `CommandGateBlock`; `Section` union; `AirlockApi` get/setAgentPolicy.
- Modify `packages/app/src/main/prefs.ts` -- default + sanitize `agentPolicy`; add `"agent"` to `SECTIONS` + `DEFAULT_SECTION_VISIBILITY`.
- Modify `packages/app/src/main/ipc.ts` -- `agentPolicy:get`/`agentPolicy:set` handlers.
- Modify `packages/app/src/preload/index.ts` -- get/setAgentPolicy wires.
- Modify `packages/app/src/main/menu.ts` -- `SECTION_LABELS.agent`.
- Modify `packages/app/src/main/mcp/tools.ts` -- `run_command` confirm + gate + audit.
- Create `packages/app/src/renderer/src/components/AgentSection.tsx`.
- Modify `packages/app/src/renderer/src/components/Sidebar.tsx` + `store.ts` (initial `sectionVisibility`) + `theme.css`.

---

## Task 1: Classifier + gate (agent-core, pure) [subagent]

**Files:**
- Create: `packages/agent-core/src/command/policy.ts`
- Test: `packages/agent-core/src/command/policy.test.ts`
- Modify: `packages/agent-core/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-core/src/command/policy.test.ts
import { describe, expect, it } from "vitest";
import {
  classifyCommand,
  DEFAULT_AGENT_POLICY,
  gateCommand,
} from "./policy";

describe("classifyCommand", () => {
  it("flags privilege escalation", () => {
    expect(classifyCommand("sudo rm x")).toContain("privilege");
    expect(classifyCommand("doas whoami")).toContain("privilege");
  });
  it("flags network tools", () => {
    expect(classifyCommand("curl http://x")).toContain("network");
    expect(classifyCommand("wget x")).toContain("network");
  });
  it("flags destructive commands", () => {
    expect(classifyCommand("rm -rf build")).toContain("destructive");
    expect(classifyCommand("git push --force")).toContain("destructive");
    expect(classifyCommand("git reset --hard HEAD~1")).toContain("destructive");
  });
  it("flags access outside the workspace", () => {
    expect(classifyCommand("cat ~/.ssh/id_rsa")).toContain("outsideWorkspace");
    expect(classifyCommand("cat ../../secret")).toContain("outsideWorkspace");
  });
  it("flags nothing for safe in-project commands", () => {
    expect(classifyCommand("npm test")).toEqual([]);
    expect(classifyCommand("git status")).toEqual([]);
    expect(classifyCommand("ls src")).toEqual([]);
  });
});

describe("gateCommand", () => {
  const P = DEFAULT_AGENT_POLICY; // network:allow, outside:ask, destructive:ask, privilege:block

  it("runs safe commands", () => {
    expect(gateCommand("npm test", P, false)).toEqual({ run: true });
  });
  it("allows network by default", () => {
    expect(gateCommand("curl http://x", P, false)).toEqual({ run: true });
  });
  it("asks for destructive without confirm, runs with confirm", () => {
    const blocked = gateCommand("rm -rf build", P, false);
    expect(blocked.run).toBe(false);
    if (blocked.run === false) {
      expect(blocked.action).toBe("ask");
      expect(blocked.categories).toContain("destructive");
      expect(blocked.reason).toMatch(/destructive/i);
    }
    expect(gateCommand("rm -rf build", P, true)).toEqual({ run: true });
  });
  it("blocks privilege absolutely -- confirm does NOT override", () => {
    expect(gateCommand("sudo rm x", P, true).run).toBe(false);
  });
  it("takes the strictest action across categories", () => {
    // sudo (block) + curl (allow) -> block
    expect(gateCommand("sudo curl http://x", P, true).run).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/agent-core/src/command/policy.test.ts`
Expected: FAIL -- cannot resolve `./policy`.

- [ ] **Step 3: Create the implementation**

```ts
// packages/agent-core/src/command/policy.ts
// Pure agent command policy: classify a shell command's risk categories and
// resolve the user's policy + confirm into run-or-block. Heuristic (reads the
// command string) -- catches the obvious dangerous patterns; deep OS isolation
// is a later slice. ASCII-only (CJS-bundled into Electron main).

export type RiskCategory =
  | "network"
  | "outsideWorkspace"
  | "destructive"
  | "privilege";

export type RiskAction = "allow" | "ask" | "block";
export type AgentCommandPolicy = Record<RiskCategory, RiskAction>;

export const DEFAULT_AGENT_POLICY: AgentCommandPolicy = {
  network: "allow",
  outsideWorkspace: "ask",
  destructive: "ask",
  privilege: "block",
};

const PATTERNS: { category: RiskCategory; re: RegExp }[] = [
  { category: "privilege", re: /(^|[\s;&|])(sudo|doas|pkexec|su)([\s;&|]|$)/ },
  {
    category: "network",
    re: /(^|[\s;&|])(curl|wget|nc|ncat|telnet|ssh|scp|sftp|ftp)([\s;&|]|$)/,
  },
  { category: "destructive", re: /(^|[\s;&|])rm\s+-\w*[rf]/ },
  { category: "destructive", re: /git\s+push\b[^;&|]*\s(--force|-f)\b/ },
  { category: "destructive", re: /git\s+reset\s+--hard/ },
  { category: "destructive", re: /git\s+clean\s+-\w*[fd]/ },
  { category: "destructive", re: /(^|[\s;&|])(dd|mkfs\w*|shred|truncate)([\s;&|]|$)/ },
  { category: "outsideWorkspace", re: /(^|\s)(~|\$HOME)\b/ },
  { category: "outsideWorkspace", re: /\.\.\// },
  { category: "outsideWorkspace", re: /(^|\s)\/(etc|root)\b/ },
  { category: "outsideWorkspace", re: /\/\.(ssh|aws|gnupg|config)\b/ },
];

export function classifyCommand(command: string): RiskCategory[] {
  const hit = new Set<RiskCategory>();
  for (const p of PATTERNS) if (p.re.test(command)) hit.add(p.category);
  return [...hit];
}

const RANK: Record<RiskAction, number> = { allow: 0, ask: 1, block: 2 };

const REASONS: Record<RiskCategory, string> = {
  network: "reaches the network",
  outsideWorkspace: "touches files outside the project",
  destructive: "is destructive",
  privilege: "uses elevated privileges",
};

export type GateResult =
  | { run: true }
  | { run: false; action: "ask" | "block"; categories: RiskCategory[]; reason: string };

// Resolve a command against the policy + confirm. Strictest matched action wins
// (block > ask > allow); none -> allow. Block is absolute; ask is overridden by
// confirm. Returns run:true to execute, else the block details.
export function gateCommand(
  command: string,
  policy: AgentCommandPolicy,
  confirm: boolean,
): GateResult {
  const categories = classifyCommand(command);
  let action: RiskAction = "allow";
  for (const c of categories) if (RANK[policy[c]] > RANK[action]) action = policy[c];
  if (action === "allow") return { run: true };
  if (action === "ask" && confirm) return { run: true };
  const reason = `This command ${categories.map((c) => REASONS[c]).join(" and ")}.`;
  return { run: false, action, categories, reason };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/agent-core/src/command/policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Export from the agent-core index**

In `packages/agent-core/src/index.ts`, add a block (next to the `./command/run` export):

```ts
export {
  type AgentCommandPolicy,
  type GateResult,
  type RiskAction,
  type RiskCategory,
  classifyCommand,
  DEFAULT_AGENT_POLICY,
  gateCommand,
} from "./command/policy";
```

Run: `npm run typecheck` -> expect clean.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-core/src/command/policy.ts packages/agent-core/src/command/policy.test.ts packages/agent-core/src/index.ts
git commit -m "feat(safety): agent command classifier + policy gate (pure)"
```

---

## Task 2: Persist the policy + IPC [subagent]

**Files:**
- Modify: `packages/app/src/shared/ipc.ts` (re-export types; `AppPrefs.agentPolicy`; `AirlockApi`)
- Modify: `packages/app/src/main/prefs.ts` (default + sanitize)
- Modify: `packages/app/src/main/ipc.ts` (handlers)
- Modify: `packages/app/src/preload/index.ts` (wires)

- [ ] **Step 1: Re-export policy types + extend AppPrefs + AirlockApi (shared/ipc.ts)**

In `packages/app/src/shared/ipc.ts`, wherever agent-core types are re-exported (near `GitStatus`/`RunCommandResult`), add `AgentCommandPolicy` (and `RiskCategory`, `RiskAction`) to the `@airlock/agent-core` re-export. Then add `agentPolicy` to the `AppPrefs` interface:

```ts
  agentPolicy: AgentCommandPolicy;
```

Add to `AirlockApi`:

```ts
  getAgentPolicy(): Promise<AgentCommandPolicy>;
  setAgentPolicy(policy: AgentCommandPolicy): Promise<AgentCommandPolicy>;
```

- [ ] **Step 2: Default + sanitize in prefs.ts**

In `packages/app/src/main/prefs.ts`, import `DEFAULT_AGENT_POLICY` (+ types) from `@airlock/agent-core`. Add to `DEFAULTS`:

```ts
  agentPolicy: { ...DEFAULT_AGENT_POLICY },
```

Add a sanitizer mirroring `sanitizeSectionVisibility` (validates each category's action is one of allow/ask/block, falling back to the default per key):

```ts
function sanitizeAgentPolicy(value: unknown): AgentCommandPolicy {
  const v = (value ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_AGENT_POLICY };
  for (const k of Object.keys(DEFAULT_AGENT_POLICY) as (keyof AgentCommandPolicy)[]) {
    const a = v[k];
    if (a === "allow" || a === "ask" || a === "block") out[k] = a;
  }
  return out;
}
```

Call it inside `sanitize(...)` so `agentPolicy: sanitizeAgentPolicy(p.agentPolicy)` is set on the returned prefs (mirroring how `sectionVisibility` is sanitized).

- [ ] **Step 3: IPC handlers (ipc.ts)**

In `packages/app/src/main/ipc.ts` (where other prefs/`sections:set` handlers live), add:

```ts
  ipcMain.handle("agentPolicy:get", async () => (await loadPrefs(prefsFile)).agentPolicy);
  ipcMain.handle("agentPolicy:set", async (_e, policy: unknown) => {
    const clean = sanitizeAgentPolicy(policy);
    return (await savePrefs(prefsFile, { agentPolicy: clean })).agentPolicy;
  });
```

Ensure `sanitizeAgentPolicy` is exported from `prefs.ts` and imported here (or inline a guard). `loadPrefs`/`savePrefs`/`prefsFile` are already in scope in this file.

- [ ] **Step 4: Preload wires**

In `packages/app/src/preload/index.ts`, add:

```ts
  getAgentPolicy: () => ipcRenderer.invoke("agentPolicy:get"),
  setAgentPolicy: (policy) => ipcRenderer.invoke("agentPolicy:set", policy),
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean. (`AppPrefs.agentPolicy` is now required, defaulted in `DEFAULTS` + sanitized; the preload satisfies `AirlockApi`.)

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/shared/ipc.ts packages/app/src/main/prefs.ts packages/app/src/main/ipc.ts packages/app/src/preload/index.ts
git commit -m "feat(safety): persist agentPolicy in prefs + get/set IPC"
```

---

## Task 3: Gate `run_command` [Opus]

**Files:**
- Modify: `packages/app/src/shared/ipc.ts` (`CommandGateBlock`)
- Modify: `packages/app/src/main/mcp/tools.ts`

- [ ] **Step 1: Add the `CommandGateBlock` shared type**

In `packages/app/src/shared/ipc.ts`, add:

```ts
export interface CommandGateBlock {
  blocked: true;
  action: "ask" | "block";
  categories: RiskCategory[];
  reason: string;
}
```

- [ ] **Step 2: Gate the tool**

In `packages/app/src/main/mcp/tools.ts`, add imports:

```ts
import { gateCommand, runCommand } from "@airlock/agent-core";
import { appendAudit } from "@airlock/agent-core";
import { loadPrefs } from "../prefs";
```

(`runCommand` is already imported -- merge it into one import; `appendAudit` may be added to the existing `@airlock/agent-core` import.)

Replace the `run_command` registration's handler body so it gates first. The full registration becomes:

```ts
  mcp.registerTool(
    "run_command",
    {
      description:
        "Run a shell command with the named vaulted secrets injected into its environment; the output is returned with secret values redacted. If the command hits a risky category under the user's agent policy it is BLOCKED (action=\"ask\" -> re-call with confirm:true to proceed; action=\"block\" -> not allowed, the user must change the policy). You never see the secret value.",
      inputSchema: {
        command: z.string(),
        injectSecrets: z.array(z.string()).optional(),
        cwd: z.string().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({ command, injectSecrets, cwd, confirm }) => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      const policy = (await loadPrefs(deps.prefsFile)).agentPolicy;
      const gate = gateCommand(command, policy, confirm ?? false);
      if (!gate.run) {
        await appendAudit(root, "agent", "command.policy.blocked", {
          action: gate.action,
          categories: gate.categories,
        }).catch(() => {});
        return ok({
          blocked: true,
          action: gate.action,
          categories: gate.categories,
          reason: gate.reason,
        });
      }
      try {
        return ok(
          await runCommand(root, command, {
            injectSecrets,
            cwd,
            baseEnv: deps.getBaseEnv(),
          }),
        );
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );
```

- [ ] **Step 3: Verify the guard + allowlist still hold + typecheck**

Run: `npx vitest run packages/app/src/main/mcp/tools.test.ts && npm run typecheck`
Expected: PASS. The tool count is unchanged (no new tool); `tools.ts` references only `gateCommand`/`runCommand`/`appendAudit`/`loadPrefs` -- none are forbidden identifiers, so the source guard stays green.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/shared/ipc.ts packages/app/src/main/mcp/tools.ts
git commit -m "feat(safety): gate run_command by the agent policy (ask=confirm, block=absolute)"
```

---

## Task 4: Agent settings sidebar section [Opus]

**Files:**
- Modify: `packages/app/src/shared/ipc.ts` (`Section` union)
- Modify: `packages/app/src/main/prefs.ts` (`SECTIONS`, `DEFAULT_SECTION_VISIBILITY`)
- Modify: `packages/app/src/main/menu.ts` (`SECTION_LABELS`)
- Modify: `packages/app/src/renderer/src/store.ts` (initial `sectionVisibility`)
- Create: `packages/app/src/renderer/src/components/AgentSection.tsx`
- Modify: `packages/app/src/renderer/src/components/Sidebar.tsx`
- Modify: `packages/app/src/renderer/src/theme.css`

- [ ] **Step 1: Add `"agent"` to every Section record**

These must all include the new key (TypeScript's `Record<Section, ...>` enforces it -- typecheck will list any you miss):
- `shared/ipc.ts` `Section` union: add `| "agent"`.
- `prefs.ts` `SECTIONS`: add `"agent"`.
- `prefs.ts` `DEFAULT_SECTION_VISIBILITY`: add `agent: true`.
- `menu.ts` `SECTION_LABELS`: add `agent: "Agent"`.
- `store.ts` initial `sectionVisibility` object: add `agent: true`.

- [ ] **Step 2: Create AgentSection.tsx**

```tsx
// packages/app/src/renderer/src/components/AgentSection.tsx
import { useCallback, useEffect, useState } from "react";
import type {
  AgentCommandPolicy,
  RiskAction,
  RiskCategory,
} from "../../../shared/ipc";

const ROWS: { key: RiskCategory; label: string }[] = [
  { key: "network", label: "Reach the network" },
  { key: "outsideWorkspace", label: "Touch files outside the project" },
  { key: "destructive", label: "Destructive (rm -rf, force push, ...)" },
  { key: "privilege", label: "Elevated privileges (sudo)" },
];
const ACTIONS: RiskAction[] = ["allow", "ask", "block"];

export function AgentSection() {
  const [policy, setPolicy] = useState<AgentCommandPolicy | null>(null);

  const refresh = useCallback(async () => {
    setPolicy(await window.airlock.getAgentPolicy());
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  if (!policy) return <div className="section-note">loading...</div>;

  const set = (key: RiskCategory, action: RiskAction) => {
    const next = { ...policy, [key]: action };
    setPolicy(next);
    void window.airlock.setAgentPolicy(next).catch(console.error);
  };

  return (
    <div className="agent-policy">
      <div className="section-note">
        How the agent's commands are gated. "Ask" lets the agent proceed only
        after it confirms with you; "Block" is absolute.
      </div>
      {ROWS.map((row) => (
        <div key={row.key} className="agent-policy-row">
          <span className="agent-policy-label">{row.label}</span>
          <select
            className="agent-policy-select"
            value={policy[row.key]}
            onChange={(e) => set(row.key, e.target.value as RiskAction)}
          >
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Render it in the sidebar**

In `packages/app/src/renderer/src/components/Sidebar.tsx`, import `AgentSection` and add (next to the other sections):

```tsx
        {vis.agent && (
          <Section id="agent" title="Agent" defaultOpen={false}>
            <AgentSection />
          </Section>
        )}
```

- [ ] **Step 4: Styling**

In `theme.css`, add:

```css
.agent-policy-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0;
}
.agent-policy-label {
  font-size: 12px;
}
.agent-policy-select {
  font-size: 12px;
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npx vitest run && npx biome check .`
Expected: typecheck clean (all `Record<Section,...>` literals now include `agent`); full suite green; biome clean (run `npx biome check --write .` if it reports formatting, then re-check).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/shared/ipc.ts packages/app/src/main/prefs.ts packages/app/src/main/menu.ts packages/app/src/renderer/src/store.ts packages/app/src/renderer/src/components/AgentSection.tsx packages/app/src/renderer/src/components/Sidebar.tsx packages/app/src/renderer/src/theme.css
git commit -m "feat(safety): Agent settings sidebar panel (per-category command policy)"
```

---

## Final verification (controller)

- [ ] **Whole-feature gate:** `npm run typecheck` (clean), `npx vitest run` (all pass), `npx biome check .` (clean).

- [ ] **Headless gate probe** (the pure decision is the security core; verify it directly). Create `policy-probe.mjs` at the repo root importing the built engine is awkward from .mjs (TS); instead this is covered by `policy.test.ts` (Task 1) which exercises classify + gate (block absolute, ask+confirm runs, strictest-wins). Re-run it and confirm green:
  `npx vitest run packages/agent-core/src/command/policy.test.ts`

- [ ] **Package + manual gate:** `npm run package`, then with the packaged app + an MCP client (or via AirLock's MCP):
  - `run_command "rm -rf node_modules"` (no confirm) -> returns `{ blocked: true, action: "ask", categories: ["destructive"], reason }`; re-call with `confirm: true` -> it runs.
  - `run_command "sudo whoami"` (even with `confirm: true`) -> `{ blocked: true, action: "block" }` (absolute).
  - `run_command "npm test"` -> runs (no gate).
  - Open the **Agent** sidebar panel, flip `destructive` to `Block` -> the destructive command is now blocked even with confirm; flip `network` to `Ask` -> `curl ...` now asks. Confirm changes persist across a relaunch.

- [ ] **Finish:** on gate approval, use superpowers:finishing-a-development-branch to merge `feat/agent-command-policy` -> `main` (local; push only on request).

---

## Self-Review

- **Spec coverage:** four categories + Allow/Ask/Block (Task 1 `gateCommand` + Task 2/4 policy); defaults (Task 1 `DEFAULT_AGENT_POLICY`); Ask=confirm / Block absolute / strictest-wins (Task 1, unit-tested); gate in `run_command` + audit (Task 3); persisted user-configurable policy + IPC (Task 2); Agent settings panel (Task 4); heuristic classification honestly scoped (Task 1 patterns). All covered.
- **Type consistency:** `RiskCategory`/`RiskAction`/`AgentCommandPolicy`/`GateResult` defined in Task 1, re-exported (Task 2), used in `AppPrefs`/`AirlockApi` (Task 2), `CommandGateBlock` (Task 3) and `AgentSection` (Task 4). `gateCommand(command, policy, confirm)` and `DEFAULT_AGENT_POLICY` names match across tasks. `loadPrefs(deps.prefsFile).agentPolicy` is the field added in Task 2.
- **Placeholders:** none -- every code step is complete.
- **Fail-safe:** prefs sanitize falls back to `DEFAULT_AGENT_POLICY` per key (Task 2); an unknown command matches no category -> allow (Task 1); the gate reads the policy fresh per call (Task 3).
