# get_terminal_tail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A `get_terminal_tail` MCP tool that lets the agent read the recent, redacted output of a terminal tab (to see the user's dev server / build / logs), with the value-redaction + audit boundary intact and zero renderer changes.

**Architecture:** Main keeps a bounded per-PTY ring buffer (a tee on the existing `onData`). Pure agent-core helpers turn raw output (ANSI + CR-overwrites) into clean text and redact it. `getTerminalTail`/`listTerminals` (main, in `ipc.ts`) read the buffer, gather ALL vaulted values, redact, and audit. A 12th MCP tool calls those deps (never `getSecretValue`), so the source-guard stays green. Terminals are identified by id + a redacted content preview (no title sync needed).

**Tech Stack:** TypeScript (strict, noUncheckedIndexedAccess), Electron, node-pty, the agent-core redactor, vitest, biome.

**Spec:** `docs/superpowers/specs/2026-06-05-terminal-tail-design.md`

**Constraints:**
- ASCII-only comments/strings in `packages/agent-core/**` and `packages/app/src/main/**` (CJS-bundled; cjs_lexer crashes on multibyte). No renderer changes in this feature.
- Do NOT reference `getSecretValue`/`getGlobalSecret`/etc. in `packages/app/src/main/mcp/tools.ts` (the source-guard). Value resolution + redaction live behind the `getTerminalTail`/`listTerminals` deps.
- `redactSecrets`, `listSecrets`, `getSecretValue`, `appendAudit` already exist; `listSecrets`/`getSecretValue`/`appendAudit` are already imported in `ipc.ts`.

---

## Task 1: agent-core terminal helpers (pure + TDD'd)

**Files:**
- Create: `packages/agent-core/src/terminal/tail.ts`
- Create: `packages/agent-core/src/terminal/tail.test.ts`
- Modify: `packages/agent-core/src/index.ts` (barrel)

- [ ] **Step 1: Write the failing tests**

Create `packages/agent-core/src/terminal/tail.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  cleanTerminalOutput,
  lastLines,
  previewLines,
  redactedPreview,
  redactedTail,
} from "./tail";

describe("cleanTerminalOutput", () => {
  it("strips ANSI color codes", () => {
    expect(cleanTerminalOutput("\x1b[32mok\x1b[0m done")).toBe("ok done");
  });
  it("strips OSC title sequences", () => {
    expect(cleanTerminalOutput("\x1b]0;a title\x07hello")).toBe("hello");
  });
  it("collapses carriage-return overwrites to the last write", () => {
    expect(cleanTerminalOutput("loading 10%\rloading 100%")).toBe("loading 100%");
  });
  it("normalizes CRLF to newlines", () => {
    expect(cleanTerminalOutput("a\r\nb")).toBe("a\nb");
  });
  it("leaves plain text untouched", () => {
    expect(cleanTerminalOutput("plain text")).toBe("plain text");
  });
});

describe("lastLines", () => {
  it("returns the last n lines", () => {
    expect(lastLines("a\nb\nc\nd", 2)).toBe("c\nd");
  });
  it("drops a single trailing empty line", () => {
    expect(lastLines("a\nb\n", 2)).toBe("a\nb");
  });
  it("returns all when n exceeds length", () => {
    expect(lastLines("a\nb", 10)).toBe("a\nb");
  });
  it("returns empty for n <= 0", () => {
    expect(lastLines("a\nb", 0)).toBe("");
  });
});

describe("previewLines", () => {
  it("returns the last n non-empty lines", () => {
    expect(previewLines("x\n\n\ny\nz\n", 2)).toBe("y\nz");
  });
  it("skips blank lines", () => {
    expect(previewLines("\n\n  \nhello\n", 3)).toBe("hello");
  });
});

describe("redactedTail (security-critical)", () => {
  it("redacts a secret value that appears in the buffer", () => {
    const raw = "\x1b[32mconnecting\x1b[0m postgres://u:supersecret@host/db\n";
    const out = redactedTail(raw, ["supersecret"], 10);
    expect(out).not.toContain("supersecret");
    expect(out).toContain("***");
  });
  it("returns the last n cleaned lines", () => {
    expect(redactedTail("a\nb\nc\n", [], 2)).toBe("b\nc");
  });
});

describe("redactedPreview", () => {
  it("redacts and returns the last n non-empty lines", () => {
    expect(redactedPreview("\n\nhello secret\n", ["secret"], 1)).toBe("hello ***");
  });
});
```

- [ ] **Step 2: Run -> fail**

Run: `cd /Users/ricardoramos/Projects/airlock && npx vitest run packages/agent-core/src/terminal/tail.test.ts`
Expected: FAIL (Cannot find module './tail').

- [ ] **Step 3: Implement `tail.ts`**

Create `packages/agent-core/src/terminal/tail.ts` (ASCII-only comments):
```ts
// Pure helpers that turn raw PTY output (ANSI escapes + carriage-return
// overwrites) into clean, redacted text for get_terminal_tail. ASCII-only:
// CJS-bundled into the Electron main process (cjs_lexer crashes on multibyte).
import { redactSecrets } from "../redact/redact";

// CSI (ESC [ ... final), OSC (ESC ] ... BEL), and other 2-char ESC sequences.
// The regex source is ASCII; it matches the ESC control byte at runtime.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping real ANSI.
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[@-Z\\-_]/g;

// Strip ANSI escapes; normalize CRLF; collapse bare-CR overwrites per line
// (keep the text after the last CR -- approximates what the terminal displays).
export function cleanTerminalOutput(raw: string): string {
  const noAnsi = raw.replace(ANSI_RE, "");
  const lines = noAnsi.replace(/\r\n/g, "\n").split("\n");
  const collapsed = lines.map((line) => {
    if (line.indexOf("\r") === -1) return line;
    const parts = line.split("\r");
    return parts[parts.length - 1] ?? "";
  });
  return collapsed.join("\n");
}

// The last n lines of (already-cleaned) text. n <= 0 -> "". Drops a single
// trailing empty line so a trailing newline does not waste a slot.
export function lastLines(text: string, n: number): string {
  if (n <= 0) return "";
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-n).join("\n");
}

// The last n NON-empty lines (for the terminal-list preview).
export function previewLines(text: string, n: number): string {
  if (n <= 0) return "";
  const nonEmpty = text.split("\n").filter((l) => l.trim().length > 0);
  return nonEmpty.slice(-n).join("\n");
}

// Clean -> last n lines -> redact every provided value. The security-critical
// composite the tool returns: a secret value present in the buffer is masked.
export function redactedTail(raw: string, values: string[], lines: number): string {
  return redactSecrets(lastLines(cleanTerminalOutput(raw), lines), values);
}

// Clean -> last n non-empty lines -> redact: the per-terminal list preview.
export function redactedPreview(raw: string, values: string[], n: number): string {
  return redactSecrets(previewLines(cleanTerminalOutput(raw), n), values);
}
```

- [ ] **Step 4: Run -> pass**

Run: `cd /Users/ricardoramos/Projects/airlock && npx vitest run packages/agent-core/src/terminal/tail.test.ts`
Expected: PASS. (If biome flags the control-char regex, the `biome-ignore` above covers it; ensure the comment is on the line directly above the regex.)

- [ ] **Step 5: Barrel export**

In `packages/agent-core/src/index.ts`, add (next to the other exports):
```ts
export { redactedPreview, redactedTail } from "./terminal/tail";
```
(Only the two composites are public; `cleanTerminalOutput`/`lastLines`/`previewLines` stay internal -- the test imports them from `./tail` directly.)

- [ ] **Step 6: Typecheck + lint + commit**

Run: `cd /Users/ricardoramos/Projects/airlock && npm run typecheck && npx vitest run packages/agent-core && npm run lint`
Expected: clean + green.
```bash
git add packages/agent-core/src/terminal/tail.ts packages/agent-core/src/terminal/tail.test.ts packages/agent-core/src/index.ts
git commit -m "feat(terminal): agent-core helpers to clean + redact raw PTY output (for get_terminal_tail)"
```

---

## Task 2: main ring buffer + getTerminalTail/listTerminals

**Files:**
- Modify: `packages/app/src/main/ipc.ts` (ring buffer tee + cleanup; `getTerminalTail`, `listTerminals`)

- [ ] **Step 1: Add the ring buffer + constants**

In `packages/app/src/main/ipc.ts`, near the `sessions` Map (the module-private `const sessions = new Map<...>()` around line 59), add:
```ts
// Per-PTY ring buffer of recent raw output (tee'd from onData). Bounded so it
// cannot grow unbounded; read (redacted) by get_terminal_tail. Deleted on exit.
const ptyBuffers = new Map<string, string>();
const TAIL_CAP = 256 * 1024; // bytes of raw output retained per terminal
const DEFAULT_TAIL_LINES = 40;
const MAX_TAIL_LINES = 400;
const PREVIEW_LINES = 3;
```
Add the agent-core imports `redactedPreview, redactedTail` to the existing `@airlock/agent-core` import block, and ensure `redactSecrets` is NOT needed here (the composites handle it). Confirm `listSecrets`, `getSecretValue`, `appendAudit` are already imported (they are).

- [ ] **Step 2: Tee the buffer in `onData` (pty:create)**

In the `pty:create` handler, replace the `dataSub` (currently at ipc.ts:580-582):
```ts
    const dataSub = s.onData((data) => {
      const prev = ptyBuffers.get(s.id) ?? "";
      const next = prev + data;
      ptyBuffers.set(s.id, next.length > TAIL_CAP ? next.slice(-TAIL_CAP) : next);
      if (!wc.isDestroyed()) wc.send("pty:data", { id: s.id, data });
    });
```

- [ ] **Step 3: Clean up the buffer on exit + on kill-all**

In the `onExit` handler (ipc.ts:583-591), add `ptyBuffers.delete(s.id);` right after `sessions.delete(s.id);`. In `killAllSessions` (ipc.ts:626-628), add `ptyBuffers.clear();` after `sessions.clear();`.

- [ ] **Step 4: Add `getTerminalTail` + `listTerminals` (exported)**

Add at the end of `ipc.ts` (after `killAllSessions`), ASCII-only:
```ts
// Resolve EVERY vaulted secret value (any could appear in terminal output) so
// the tail/preview can be redacted. Mirrors the db:list value-gather. Main-only.
async function allVaultedValues(root: string): Promise<string[]> {
  const metas = await listSecrets(root);
  const values: string[] = [];
  for (const m of metas) {
    const v = await getSecretValue(root, m.name);
    if (v) values.push(v);
  }
  return values;
}

// The redacted tail of one terminal's recent output. Root-gated + audited
// (ids/counts only -- never the content). The MCP tool calls THIS (not
// getSecretValue), so the tools.ts source-guard stays green.
export async function getTerminalTail(
  termId: string,
  lines: number,
): Promise<{ tail: string } | { error: string }> {
  if (!workspaceRoot) return { error: "No workspace open" };
  const raw = ptyBuffers.get(termId);
  if (raw === undefined) return { error: "No such terminal" };
  const n = Math.min(
    MAX_TAIL_LINES,
    Math.max(1, Math.floor(lines) || DEFAULT_TAIL_LINES),
  );
  const values = await allVaultedValues(workspaceRoot);
  const tail = redactedTail(raw, values, n);
  await appendAudit(workspaceRoot, "agent", "terminal.read", { termId, lines: n });
  return { tail };
}

// List live terminals with a short redacted content preview so the agent can
// tell them apart (dev-server logs vs idle shell) and pick an id.
export async function listTerminals(): Promise<
  { id: string; preview: string }[]
> {
  const values = workspaceRoot ? await allVaultedValues(workspaceRoot) : [];
  const out: { id: string; preview: string }[] = [];
  for (const id of sessions.keys()) {
    const raw = ptyBuffers.get(id) ?? "";
    out.push({ id, preview: redactedPreview(raw, values, PREVIEW_LINES) });
  }
  return out;
}
```

- [ ] **Step 5: Typecheck + lint + commit**

Run: `cd /Users/ricardoramos/Projects/airlock && npm run typecheck && npm test && npm run lint`
Expected: clean + all green (no new tests here; the buffer logic is exercised at the live gate, the redaction is unit-tested in Task 1).
```bash
git add packages/app/src/main/ipc.ts
git commit -m "feat(terminal): per-PTY ring buffer + getTerminalTail/listTerminals (redacted, audited)"
```

---

## Task 3: the get_terminal_tail MCP tool (12th) + wiring

**Files:**
- Modify: `packages/app/src/main/mcp/tools.ts` (TOOL_NAMES -> 12; ToolDeps; register the tool)
- Modify: `packages/app/src/main/mcp/server.ts` (McpDeps; forward to registerTools)
- Modify: `packages/app/src/main/index.ts` (pass the deps from ./ipc)
- Modify: `packages/app/src/main/mcp/tools.test.ts` (allowlist 11 -> 12; a tool test)

- [ ] **Step 1: TOOL_NAMES + ToolDeps (tools.ts)**

Add `"get_terminal_tail"` to the end of `TOOL_NAMES` (ipc.ts... `tools.ts:28-40`). Add to `ToolDeps` (tools.ts:45-58):
```ts
  getTerminalTail: (
    termId: string,
    lines: number,
  ) => Promise<{ tail: string } | { error: string }>;
  listTerminals: () => Promise<{ id: string; preview: string }[]>;
```

- [ ] **Step 2: Register the tool (tools.ts)**

After the `run_command` registration (tools.ts:218), add:
```ts
  // Read the recent output of a terminal tab so the agent can see what the user
  // is running (dev server, build, tests, logs). No terminalId -> list terminals
  // (id + redacted preview); with terminalId -> that terminal's redacted tail.
  // Resolution + redaction live behind the deps (getTerminalTail/listTerminals),
  // so this handler references no value-returning identifier (source-guard green).
  mcp.registerTool(
    "get_terminal_tail",
    {
      description:
        "Read the recent output (tail) of a terminal tab so you can see what the user is running (dev server, build, tests, logs). Call with no terminalId to list terminals (each with a short preview); call with a terminalId to get that terminal's recent output. Secret values are redacted -- you never see them.",
      inputSchema: {
        terminalId: z.string().optional(),
        lines: z.number().optional(),
      },
    },
    async ({ terminalId, lines }) => {
      if (!deps.getWorkspaceRoot()) return err(NO_WORKSPACE);
      if (!terminalId) return ok(await deps.listTerminals());
      const res = await deps.getTerminalTail(terminalId, lines ?? 40);
      return "error" in res ? err(res.error) : ok(res);
    },
  );
```

- [ ] **Step 3: McpDeps + forward (server.ts)**

In `packages/app/src/main/mcp/server.ts`, add to `McpDeps` (server.ts:35-44):
```ts
  getTerminalTail: (
    termId: string,
    lines: number,
  ) => Promise<{ tail: string } | { error: string }>;
  listTerminals: () => Promise<{ id: string; preview: string }[]>;
```
And in `createMcpServer`'s `registerTools(...)` call (server.ts:73-78), forward both (alongside the existing fields, NOT `token`):
```ts
    getTerminalTail: deps.getTerminalTail,
    listTerminals: deps.listTerminals,
```

- [ ] **Step 4: Wire the deps from ipc (index.ts)**

In `packages/app/src/main/index.ts`: import `getTerminalTail, listTerminals` from `./ipc` (the block that imports `getWorkspaceRoot`). In the `startMcpServer(port, {...})` call (index.ts:143-154), add:
```ts
      getTerminalTail,
      listTerminals,
```

- [ ] **Step 5: Update the allowlist guard + add a tool test (tools.test.ts)**

In `packages/app/src/main/mcp/tools.test.ts`: change `toHaveLength(11)` -> `toHaveLength(12)` (the `.toEqual([...TOOL_NAMES].sort())` auto-syncs). Add a test block mirroring the run_command tests: a fake deps with spy `getTerminalTail`/`listTerminals`, assert (a) no-workspace short-circuits to an error before calling the deps, (b) no terminalId calls `listTerminals`, (c) a terminalId calls `getTerminalTail` and an `{error}` result surfaces as isError. The source-guard FORBIDDEN test needs NO change (the tool references none of those names) -- confirm it still passes.

- [ ] **Step 6: Typecheck + test + lint + build + commit**

Run: `cd /Users/ricardoramos/Projects/airlock && npm run typecheck && npm test && npm run lint && npm run build`
Expected: all green; allowlist now 12; source-guard still green; record the test count.
```bash
git add packages/app/src/main/mcp/tools.ts packages/app/src/main/mcp/server.ts packages/app/src/main/index.ts packages/app/src/main/mcp/tools.test.ts
git commit -m "feat(terminal): get_terminal_tail MCP tool (12th) wired to the redacted tail deps"
```

---

## Task 4: docs + verify + repackage

**Files:**
- Modify: `docs/superpowers/specs/2026-06-05-terminal-tail-design.md` (status -> v1 complete)
- Modify: `packages/app/resources/mcp-docs/tools.md` (document get_terminal_tail; the set is now 12)
- Modify: `packages/app/resources/mcp-docs/security-model.md` (the terminal-read path: redacted + audited, honest limits)
- Modify: `README.md` (if it lists agent tools)

- [ ] **Step 1: tools.md** -- add `get_terminal_tail` to the tool list (now 12): what it does (read a terminal tab's recent output; no id -> list with previews; id -> redacted tail), that secret values are redacted, and the honest limits (logs-accurate / TUI-approximate; literal-redaction caveat; the agent's own terminal appears in the list).

- [ ] **Step 2: security-model.md** -- note the agent can read terminal output via `get_terminal_tail`, but it is value-redacted (ALL vaulted values) + audited (`terminal.read`, ids/counts only), the tool calls a dep (source-guard green, allowlist now 12), and it observes the user's session (the first such capability) under the same redact+audit boundary.

- [ ] **Step 3: README** -- if it lists agent tools/capabilities, add one line for `get_terminal_tail` (read your terminals' recent output, redacted). Skip if no such list.

- [ ] **Step 4: spec status** -> `**Status:** v1 complete.`

- [ ] **Step 5: Full verification**
Run: `cd /Users/ricardoramos/Projects/airlock && npm run typecheck && npm test && npm run lint && npm run build`
All green; record the test count.

- [ ] **Step 6: Repackage**
Run: `cd /Users/ricardoramos/Projects/airlock && npm run package`
Confirm a fresh `.app` builds (the "skipped code signing / identity null" notice is expected). Note the timestamp.

- [ ] **Step 7: Commit**
```bash
git add docs/superpowers/specs/2026-06-05-terminal-tail-design.md packages/app/resources/mcp-docs/ README.md
git commit -m "docs(terminal): document get_terminal_tail; verify + repackage"
```

---

## Self-review notes
- No agent value path beyond the redacted tail: the tool calls `getTerminalTail`/`listTerminals` deps; `tools.ts` references no value-returning identifier (source-guard green); allowlist 11 -> 12.
- Redaction covers ALL vaulted values + is unit-tested (redactedTail/redactedPreview); audited name/count-only.
- Ring buffer bounded (256KB/PTY) + cleaned up on exit + kill-all.
- No renderer changes (content-preview enumerate, no title sync).
- ASCII in agent-core + main; honest limits documented (raw approximation, literal redaction, own-terminal-in-list, buffer bound).
