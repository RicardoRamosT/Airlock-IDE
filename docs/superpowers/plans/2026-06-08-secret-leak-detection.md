# Secret-Leak Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect vaulted secret values + known secret patterns in content before it's persisted/committed, surfacing it as a quiet advisory to the human and an explicit confirmation gate to the agent -- never revealing the value.

**Architecture:** A pure `scanForSecrets` engine (agent-core) returns value-free findings; a main-side orchestrator reads staged/working content (via the existing `gitFileVersions`) and the vault (via a new `vaultedSecrets`); a main-side `guardedCommit` composes scan + commit with two behaviors (advisory for the human IPC, gated for a new `git_commit` MCP tool); `git_status` gains `secretLeaks`; `GitSection` shows a quiet indicator.

**Tech Stack:** TypeScript, Electron, MCP (@modelcontextprotocol/sdk), raw `git` via execFile, vitest, biome.

**Spec:** `docs/superpowers/specs/2026-06-08-secret-leak-detection-design.md`

**Refinements vs spec:** (a) literal vaulted matching uses `String.includes` per line, so no `escapeRegExp` export is needed; (b) `commitStaged` (agent-core) stays unchanged -- the scan + dual behavior live in a main-side `guardedCommit`; (c) the orchestrator returns `SecretLeak[]` directly (no intermediate `FileLeaks`).

**Execution (hybrid):** Tasks 1-3 are mechanical/pure -> subagents. Tasks 4-6 (commit-contract change, the security-sensitive MCP tool, GitSection wiring) -> implement on Opus.

---

## File Structure

- Create `packages/agent-core/src/redact/scan.ts` -- pure `scanForSecrets` + `SecretFinding`.
- Create `packages/agent-core/src/redact/scan.test.ts`.
- Modify `packages/agent-core/src/index.ts` -- export `scanForSecrets`, `SecretFinding`, `vaultedSecrets`.
- Modify `packages/agent-core/src/broker/broker.ts` -- add `vaultedSecrets`.
- Modify `packages/app/src/main/ipc.ts` -- refactor `allVaultedValues` onto `vaultedSecrets`; switch `git:commit` to `guardedCommit`.
- Create `packages/app/src/main/secrets/scan.ts` -- `scanStaged` / `scanWorkingSet` orchestrators.
- Create `packages/app/src/main/secrets/commit.ts` -- `guardedCommit`.
- Create `packages/app/src/main/secrets/commit.test.ts`.
- Modify `packages/app/src/shared/ipc.ts` -- `SecretLeak`, `CommitOutcome`; `gitCommit` return type.
- Modify `packages/app/src/main/mcp/tools.ts` -- `git_commit` tool, `git_status` augmentation, allowlist.
- Modify `packages/app/src/main/mcp/tools.test.ts` -- add `vaultedSecrets` to the forbidden list.
- Modify `packages/app/src/renderer/src/components/GitSection.tsx` + `theme.css` -- quiet indicator.

---

## Task 1: `scanForSecrets` engine (agent-core, pure) [subagent]

**Files:**
- Create: `packages/agent-core/src/redact/scan.ts`
- Test: `packages/agent-core/src/redact/scan.test.ts`
- Modify: `packages/agent-core/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-core/src/redact/scan.test.ts
import { describe, expect, it } from "vitest";
import { scanForSecrets } from "./scan";

describe("scanForSecrets", () => {
  it("finds a vaulted value literally and names it (1-indexed line)", () => {
    const text = "const a = 1;\nconst k = \"supersecretvalue\";\n";
    const f = scanForSecrets(text, [{ name: "API_KEY", value: "supersecretvalue" }]);
    expect(f).toEqual([{ line: 2, kind: "vaulted", name: "API_KEY" }]);
  });

  it("ignores vaulted values shorter than 4 chars", () => {
    const f = scanForSecrets("x = abc", [{ name: "S", value: "abc" }]);
    expect(f).toEqual([]);
  });

  it("flags known patterns by type, even when not vaulted", () => {
    const text = "key = \"sk_live_abcdefghijklmnop12345\"\n";
    const f = scanForSecrets(text, []);
    expect(f).toEqual([{ line: 1, kind: "pattern", patternType: "stripe-secret" }]);
  });

  it("flags a PEM private key header", () => {
    const f = scanForSecrets("-----BEGIN RSA PRIVATE KEY-----", []);
    expect(f).toEqual([{ line: 1, kind: "pattern", patternType: "pem-private-key" }]);
  });

  it("dedupes per line + identity", () => {
    const text = "tok tok"; // same vaulted value twice on one line
    const f = scanForSecrets(text, [{ name: "T", value: "tok" === "tok" ? "tok " : "" }]);
    // value "tok " (4 chars incl. space) appears twice on line 1 -> one finding
    expect(f.filter((x) => x.name === "T")).toHaveLength(1);
  });

  it("never includes the secret value in any finding", () => {
    const value = "topsecretpassword";
    const f = scanForSecrets(`pw=${value}`, [{ name: "PW", value }]);
    expect(JSON.stringify(f)).not.toContain(value);
    expect(f).toEqual([{ line: 1, kind: "vaulted", name: "PW" }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/agent-core/src/redact/scan.test.ts`
Expected: FAIL -- cannot resolve `./scan`.

- [ ] **Step 3: Create the implementation**

```ts
// packages/agent-core/src/redact/scan.ts
// Pure secret scanner: find vaulted VALUES (literal) and known secret PATTERNS in
// text, returning VALUE-FREE findings (name/type + 1-indexed line). Used by the
// main-side commit/status scan. ASCII-only (CJS-bundled into Electron main).

export interface SecretFinding {
  line: number; // 1-indexed
  kind: "vaulted" | "pattern";
  name?: string; // set when kind === "vaulted"
  patternType?: string; // set when kind === "pattern"
}

// Unanchored provider shapes mirroring broker/validators.ts (which anchors whole
// values). Excludes the public stripe-publishable shape. Advisory -- false
// positives are cheap under the advisory/agent-confirm model.
const SECRET_PATTERNS: { patternType: string; re: RegExp }[] = [
  { patternType: "stripe-secret", re: /sk_(live|test)_[A-Za-z0-9]{16,}/ },
  { patternType: "aws-access-key-id", re: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { patternType: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { patternType: "slack-token", re: /\bxox[bpars]-[A-Za-z0-9-]{10,}\b/ },
  { patternType: "anthropic-api-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { patternType: "pem-private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    patternType: "jwt",
    re: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  },
];

export function scanForSecrets(
  text: string,
  vaulted: { name: string; value: string }[],
): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const seen = new Set<string>();
  const add = (line: number, f: Omit<SecretFinding, "line">): void => {
    const key = `${line}:${f.name ?? f.patternType ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ line, ...f });
  };
  // 4-char floor matches the redactor: shorter values are noise.
  const values = vaulted.filter((s) => s.value.length >= 4);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineNo = i + 1;
    for (const s of values) {
      if (line.includes(s.value)) add(lineNo, { kind: "vaulted", name: s.name });
    }
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(line)) add(lineNo, { kind: "pattern", patternType: p.patternType });
    }
  }
  return findings;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/agent-core/src/redact/scan.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Export from the agent-core index**

In `packages/agent-core/src/index.ts`, add (near the other redact exports):

```ts
export { scanForSecrets, type SecretFinding } from "./redact/scan";
```

Run: `npm run typecheck` -> expect clean.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-core/src/redact/scan.ts packages/agent-core/src/redact/scan.test.ts packages/agent-core/src/index.ts
git commit -m "feat(safety): scanForSecrets engine (vaulted values + provider patterns)"
```

---

## Task 2: `vaultedSecrets` gatherer + refactor `allVaultedValues` [subagent]

**Files:**
- Modify: `packages/agent-core/src/broker/broker.ts` (add `vaultedSecrets`)
- Modify: `packages/agent-core/src/index.ts` (export it)
- Modify: `packages/app/src/main/ipc.ts` (refactor `allVaultedValues`)

- [ ] **Step 1: Add `vaultedSecrets` to the broker**

In `packages/agent-core/src/broker/broker.ts`, add this exported function next to `getSecretValue` (it reuses the module's existing `listSecrets` + `getSecretValue` -- import them if they live in a sibling module):

```ts
// Gather every vaulted secret as { name, value } pairs (main-only; reads the
// keychain). The named counterpart of the value-only gather used for redaction.
export async function vaultedSecrets(
  root: string,
): Promise<{ name: string; value: string }[]> {
  const metas = await listSecrets(root);
  const out: { name: string; value: string }[] = [];
  for (const m of metas) {
    const v = await getSecretValue(root, m.name);
    if (v) out.push({ name: m.name, value: v });
  }
  return out;
}
```

- [ ] **Step 2: Export it from the agent-core index**

In `packages/agent-core/src/index.ts`, add to the broker exports:

```ts
export { vaultedSecrets } from "./broker/broker";
```

(If broker exports are surfaced via a barrel like `./broker`, add `vaultedSecrets` there instead, matching how `getSecretValue`/`listSecrets` are exported.)

- [ ] **Step 3: Refactor `allVaultedValues` in ipc.ts onto it**

In `packages/app/src/main/ipc.ts`, replace the body of `allVaultedValues` (currently a `listSecrets` + `getSecretValue` loop, ~lines 1079-1089) with a thin map over `vaultedSecrets`, and add `vaultedSecrets` to the existing `@airlock/agent-core` import:

```ts
// Resolve EVERY vaulted secret value (any could appear in terminal output) so
// the tail/preview can be redacted. Delegates to the broker's named gather.
async function allVaultedValues(root: string): Promise<string[]> {
  return (await vaultedSecrets(root)).map((s) => s.value);
}
```

- [ ] **Step 4: Verify nothing regressed**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean; full suite still green (the two `allVaultedValues` callsites -- terminal tail/preview -- are unchanged and keep working).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/broker/broker.ts packages/agent-core/src/index.ts packages/app/src/main/ipc.ts
git commit -m "feat(safety): vaultedSecrets gatherer; route allVaultedValues through it"
```

---

## Task 3: Scan orchestrator + shared types [subagent]

**Files:**
- Modify: `packages/app/src/shared/ipc.ts` (add `SecretLeak`, `CommitOutcome`)
- Create: `packages/app/src/main/secrets/scan.ts`

- [ ] **Step 1: Add the shared types**

In `packages/app/src/shared/ipc.ts`, after the `LspDefinition` interface, add:

```ts
export interface SecretLeak {
  path: string;
  line: number;
  name?: string; // vaulted secret name (kind "vaulted")
  patternType?: string; // provider type (kind "pattern")
}

export interface CommitOutcome {
  committed: boolean;
  sha: string | null;
  blocked?: boolean; // true when a gated commit was held back by a suspected leak
  leaks: SecretLeak[];
}
```

- [ ] **Step 2: Create the orchestrator**

```ts
// packages/app/src/main/secrets/scan.ts
// Main-side secret scan: reads staged/working content + the vault and runs the
// pure scanForSecrets, returning VALUE-FREE SecretLeak[]. The only place that
// pulls secret values into a scan. ASCII-only.
import {
  gitFileVersions,
  gitStatus,
  scanForSecrets,
  vaultedSecrets,
} from "@airlock/agent-core";
import type { SecretLeak } from "../../shared/ipc";

const MAX_SCAN_BYTES = 1_000_000; // skip files bigger than the editor read cap

async function scanFiles(
  root: string,
  paths: string[],
  which: "staged" | "working",
): Promise<SecretLeak[]> {
  const vaulted = await vaultedSecrets(root);
  if (vaulted.length === 0 && which === "working") {
    // patterns still apply even with an empty vault, so do not early-return;
    // this branch is only a readability marker -- fall through.
  }
  const leaks: SecretLeak[] = [];
  for (const p of paths) {
    let modified: string;
    let binary: boolean;
    try {
      const v = await gitFileVersions(root, p, which);
      modified = v.modified;
      binary = v.binary;
    } catch {
      continue; // unreadable at this ref -- skip
    }
    if (binary || modified.length > MAX_SCAN_BYTES) continue;
    for (const f of scanForSecrets(modified, vaulted)) {
      leaks.push({
        path: p,
        line: f.line,
        name: f.name,
        patternType: f.patternType,
      });
    }
  }
  return leaks;
}

// Staged content -- exactly what a commit would persist.
export async function scanStaged(root: string): Promise<SecretLeak[]> {
  const status = await gitStatus(root);
  return scanFiles(
    root,
    status.staged.map((c) => c.path),
    "staged",
  );
}

// Changed working files (modified + untracked) -- what the agent sees via status.
export async function scanWorkingSet(root: string): Promise<SecretLeak[]> {
  const status = await gitStatus(root);
  const paths = [...status.unstaged.map((c) => c.path), ...status.untracked];
  return scanFiles(root, paths, "working");
}
```

- [ ] **Step 3: Verify imports resolve**

Run: `npm run typecheck`
Expected: clean. If `gitFileVersions` / `gitStatus` / `scanForSecrets` / `vaultedSecrets` are not re-exported from the agent-core index, add them to `packages/agent-core/src/index.ts` (main already consumes `gitFileVersions`/`gitStatus`, so they are almost certainly exported).

Note: `scanStaged`/`scanWorkingSet` are integration glue over git + keychain; they are exercised by the headless probe + manual gate in Final Verification (not a unit test here).

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/shared/ipc.ts packages/app/src/main/secrets/scan.ts
git commit -m "feat(safety): SecretLeak/CommitOutcome types + staged/working scan orchestrator"
```

---

## Task 4: `guardedCommit` + advisory `git:commit` IPC [Opus]

**Files:**
- Create: `packages/app/src/main/secrets/commit.ts`
- Test: `packages/app/src/main/secrets/commit.test.ts`
- Modify: `packages/app/src/main/ipc.ts` (`git:commit` handler)
- Modify: `packages/app/src/shared/ipc.ts` (`gitCommit` return type)

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/main/secrets/commit.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@airlock/agent-core", () => ({ commitStaged: vi.fn(async () => "abc1234") }));
vi.mock("./scan", () => ({ scanStaged: vi.fn() }));

import { commitStaged } from "@airlock/agent-core";
import { guardedCommit } from "./commit";
import { scanStaged } from "./scan";

const commitMock = commitStaged as unknown as ReturnType<typeof vi.fn>;
const scanMock = scanStaged as unknown as ReturnType<typeof vi.fn>;
const leak = { path: "a.ts", line: 3, name: "API_KEY" };

describe("guardedCommit", () => {
  it("advisory: commits even with leaks, returns them", async () => {
    scanMock.mockResolvedValue([leak]);
    commitMock.mockClear();
    const out = await guardedCommit("/r", "msg", { gated: false });
    expect(commitMock).toHaveBeenCalledWith("/r", "msg");
    expect(out).toEqual({ committed: true, sha: "abc1234", leaks: [leak] });
  });

  it("gated + leaks + no confirm: blocks, does not commit", async () => {
    scanMock.mockResolvedValue([leak]);
    commitMock.mockClear();
    const out = await guardedCommit("/r", "msg", { gated: true });
    expect(commitMock).not.toHaveBeenCalled();
    expect(out).toEqual({ committed: false, sha: null, blocked: true, leaks: [leak] });
  });

  it("gated + confirm: commits despite leaks", async () => {
    scanMock.mockResolvedValue([leak]);
    commitMock.mockClear();
    const out = await guardedCommit("/r", "msg", { gated: true, confirm: true });
    expect(commitMock).toHaveBeenCalledWith("/r", "msg");
    expect(out).toEqual({ committed: true, sha: "abc1234", leaks: [leak] });
  });

  it("gated + clean: commits normally", async () => {
    scanMock.mockResolvedValue([]);
    commitMock.mockClear();
    const out = await guardedCommit("/r", "msg", { gated: true });
    expect(out).toEqual({ committed: true, sha: "abc1234", leaks: [] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/app/src/main/secrets/commit.test.ts`
Expected: FAIL -- cannot resolve `./commit`.

- [ ] **Step 3: Implement `guardedCommit`**

```ts
// packages/app/src/main/secrets/commit.ts
// Compose the staged-secret scan with the commit. Advisory (human IPC): commit
// regardless, return the leaks. Gated (agent git_commit tool): hold back a
// suspected-leak commit until confirm:true. ASCII-only.
import { commitStaged } from "@airlock/agent-core";
import type { CommitOutcome } from "../../shared/ipc";
import { scanStaged } from "./scan";

export async function guardedCommit(
  root: string,
  message: string,
  opts: { gated: boolean; confirm?: boolean },
): Promise<CommitOutcome> {
  const leaks = await scanStaged(root);
  if (opts.gated && leaks.length > 0 && !opts.confirm) {
    return { committed: false, sha: null, blocked: true, leaks };
  }
  const sha = await commitStaged(root, message);
  return { committed: true, sha, leaks };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/app/src/main/secrets/commit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Switch the `git:commit` IPC handler to advisory `guardedCommit`**

In `packages/app/src/main/ipc.ts`, change the handler (currently `return commitStaged(resolveRoot(e, root), message);`) and add the import:

```ts
  ipcMain.handle("git:commit", (e, root: unknown, message: unknown) => {
    if (typeof message !== "string") throw new Error("Invalid payload");
    return guardedCommit(resolveRoot(e, root), message, { gated: false });
  });
```

Add `import { guardedCommit } from "./secrets/commit";` near the top. If `commitStaged` is now unused in ipc.ts, remove it from the agent-core import.

- [ ] **Step 6: Update the `gitCommit` return type**

In `packages/app/src/shared/ipc.ts`, change the `AirlockApi.gitCommit` signature:

```ts
  gitCommit(root: string, message: string): Promise<CommitOutcome>;
```

(The preload wire `gitCommit: (root, message) => ipcRenderer.invoke("git:commit", root, message)` is unchanged.)

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean. GitSection currently ignores `gitCommit`'s return value, so the type change does not break it (its indicator comes in Task 6).

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/main/secrets/commit.ts packages/app/src/main/secrets/commit.test.ts packages/app/src/main/ipc.ts packages/app/src/shared/ipc.ts
git commit -m "feat(safety): guardedCommit (advisory/gated) + advisory git:commit IPC"
```

---

## Task 5: `git_commit` MCP tool + `git_status` leaks + CI guard [Opus]

**Files:**
- Modify: `packages/app/src/main/mcp/tools.ts`
- Modify: `packages/app/src/main/mcp/tools.test.ts`

- [ ] **Step 1: Extend the CI guard test first (failing)**

In `packages/app/src/main/mcp/tools.test.ts`, add `"vaultedSecrets"` to the `FORBIDDEN` array:

```ts
  const FORBIDDEN = [
    "getSecretValue",
    "getGlobalSecret",
    "neonConnectionUri",
    "dbConnString",
    "injectInto",
    "vaultedSecrets",
  ];
```

Run: `npx vitest run packages/app/src/main/mcp/tools.test.ts`
Expected: still PASS (tools.ts does not yet reference `vaultedSecrets`) -- this locks the invariant before we add code that must respect it.

- [ ] **Step 2: Add the `git_commit` tool + augment `git_status`**

In `packages/app/src/main/mcp/tools.ts`, add the imports (top of file, with the other relative imports):

```ts
import { guardedCommit } from "../secrets/commit";
import { scanWorkingSet } from "../secrets/scan";
```

Replace the `git_status` registration body so it includes leaks:

```ts
  mcp.registerTool(
    "git_status",
    { description: "Report the working-tree git status for the workspace, including any files whose content contains a suspected secret value (secretLeaks: name/type + path:line, never the value)." },
    async () => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      const status = await ide.gitStatusFor(root);
      return ok({ ...status, secretLeaks: await scanWorkingSet(root) });
    },
  );
```

Add the `git_commit` tool registration immediately after `run_command`'s:

```ts
  mcp.registerTool(
    "git_commit",
    {
      description:
        "Commit the staged changes. If the staged content contains a suspected secret value, the commit is BLOCKED and the leak locations are returned (name/type + path:line, never the value) -- tell the user, then re-call with confirm:true to commit anyway.",
      inputSchema: { message: z.string(), confirm: z.boolean().optional() },
    },
    async ({ message, confirm }) => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      try {
        return ok(await guardedCommit(root, message, { gated: true, confirm }));
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );
```

- [ ] **Step 3: Add `git_commit` to the locked allowlist**

In the `TOOL_NAMES` array in `tools.ts`, add `"git_commit"` (next to `"git_status"`):

```ts
  "git_status",
  "git_commit",
```

- [ ] **Step 4: Verify the guard holds + tools stay in sync**

Run: `npx vitest run packages/app/src/main/mcp/tools.test.ts && npm run typecheck`
Expected: PASS. The forbidden-identifier guard passes because `tools.ts` imports `guardedCommit`/`scanWorkingSet` (not `vaultedSecrets`/`getSecretValue` directly). If there is an allowlist-vs-registered test, `git_commit` is now in both.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/mcp/tools.ts packages/app/src/main/mcp/tools.test.ts
git commit -m "feat(safety): git_commit MCP tool (gated) + git_status secretLeaks + CI guard"
```

---

## Task 6: GitSection quiet advisory indicator [Opus]

**Files:**
- Modify: `packages/app/src/renderer/src/components/GitSection.tsx`
- Modify: `packages/app/src/renderer/src/theme.css`

- [ ] **Step 1: Capture the commit outcome's leaks**

In `GitSection.tsx`, add `SecretLeak` to the `../../../shared/ipc` import and a leaks state near the other `useState`s:

```ts
const [leaks, setLeaks] = useState<SecretLeak[]>([]);
```

Change the commit `onClick` to record the outcome's leaks:

```tsx
        onClick={() =>
          void run(async () => {
            const outcome = await window.airlock.gitCommit(root, message);
            setLeaks(outcome.leaks);
            setMessage("");
          })
        }
```

- [ ] **Step 2: Render the quiet, non-blocking indicator**

Immediately after the commit `<button>` (and before/after the `{error && ...}` line), add:

```tsx
      {leaks.length > 0 && (
        <div className="git-leak-warning" role="status">
          {leaks.length} location(s) contain secret values:
          <ul>
            {leaks.map((l) => (
              <li key={`${l.path}:${l.line}:${l.name ?? l.patternType}`}>
                {l.name ?? l.patternType} in {l.path}:{l.line}
              </li>
            ))}
          </ul>
        </div>
      )}
```

The commit button's `disabled` is unchanged -- the indicator never blocks committing.

- [ ] **Step 3: Add quiet styling**

In `theme.css`, add (muted/warning text, no modal chrome):

```css
.git-leak-warning {
  margin-top: 6px;
  font-size: 12px;
  color: var(--warning, #d08770);
  opacity: 0.9;
}
.git-leak-warning ul {
  margin: 4px 0 0;
  padding-left: 16px;
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npx vitest run && npx biome check .`
Expected: typecheck clean; full suite green; biome clean (run `npx biome check --write .` if it reports formatting, then re-check).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/renderer/src/components/GitSection.tsx packages/app/src/renderer/src/theme.css
git commit -m "feat(safety): quiet GitSection indicator for committed secret values"
```

---

## Final verification (controller)

- [ ] **Whole-feature gate:** `npm run typecheck` (clean), `npx vitest run` (all pass), `npx biome check .` (clean).

- [ ] **Headless MCP-path probe** (the agent gate + status leaks, exercised through the real scan over a real git repo). Create `leak-probe.mjs` at the repo root, run `node leak-probe.mjs`, confirm the reported behavior, then delete it. It builds a temp git repo, stages a file containing a known value, and drives the main-side functions directly via a tiny TS-on-the-fly import is not available from .mjs -- so instead verify via git + the pure engine, and gate the MCP tool behavior in the packaged app:

```js
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "leak-"));
const g = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
g("init", "-q");
g("config", "user.email", "t@t");
g("config", "user.name", "t");
writeFileSync(path.join(dir, "config.ts"), 'export const k = "supersecretvalue123";\n');
g("add", "config.ts");
// staged blob content (what scanStaged reads via `git show :0:<path>`):
const staged = g("show", ":0:config.ts");
console.log("staged blob has the value:", staged.includes("supersecretvalue123"));
console.log(staged.includes("supersecretvalue123") ? "PASS: scanStaged would see it" : "FAIL");
```

   Expected: PASS (the staged blob the orchestrator reads contains the value, so `scanForSecrets` would flag it). The full agent gate is gated below in the app.

- [ ] **Package + manual gate:** `npm run package`, then in the packaged app, with a project that has a vaulted secret:
  - Put that secret's value into a tracked file, stage it, and commit via the GitSection -> commit succeeds, and the quiet "N location(s) contain secret values" indicator appears (human = advisory, never blocked).
  - From an MCP client (Claude), call `git_commit` on the same staged set -> it returns `blocked: true` with the leak location (name + path:line, no value); re-call with `confirm: true` -> it commits.
  - Call `git_status` -> the result includes `secretLeaks`.

- [ ] **Finish:** on gate approval, use superpowers:finishing-a-development-branch to merge `feat/secret-leak-detection` -> `main` (local; push only on request).

---

## Self-Review

- **Spec coverage:** engine vaulted+patterns (Task 1); value-free findings + no-value test (Task 1); `vaultedSecrets` + DRY `allVaultedValues` (Task 2); orchestrator staged/working, binary + size skip (Task 3); `commitStaged` unchanged, dual behavior in `guardedCommit` (Task 4); advisory human IPC (Task 4); gated agent tool + `git_status` leaks (Task 5); secret-blind CI guard extended (Task 5); quiet human indicator, never blocks (Task 6). All spec points covered.
- **Type consistency:** `SecretFinding {line,kind,name?,patternType?}` (Task 1) -> mapped to `SecretLeak {path,line,name?,patternType?}` (Task 3) -> carried in `CommitOutcome {committed,sha,blocked?,leaks}` (Task 3) -> returned by `guardedCommit` (Task 4) + `gitCommit` AirlockApi (Task 4) + consumed in GitSection (Task 6). `guardedCommit(root,message,{gated,confirm?})` signature identical across Tasks 4-5.
- **Placeholders:** none -- every code step is complete.
- **Secret-blind invariant:** values are read only inside `vaultedSecrets`/`scanFiles`; findings/leaks carry name/type + location only; the no-value unit test (Task 1) + the extended CI guard (Task 5) enforce it.
