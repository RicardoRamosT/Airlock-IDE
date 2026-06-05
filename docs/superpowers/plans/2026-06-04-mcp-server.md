# airlock MCP Server (IDE-Bridge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** airlock hosts a local HTTP MCP server so the Claude Code in its terminal gains IDE-awareness (markdown resources), live status reads, and one UI-control tool (show/hide sidebar sections) — without ever being able to read a secret value.

**Architecture:** An MCP server runs in the Electron MAIN process (`http://127.0.0.1:<port>/mcp`, bearer-token-guarded, `@modelcontextprotocol/sdk`). Its tools are a thin layer over a new shared `ide-state` module (the status-read logic, extracted from the existing IPC handlers so IPC and MCP share one source of truth) plus the existing `changeSectionVisibility` funnel. Markdown resources ship with the app. On folder-open, airlock registers itself in Claude Code's local scope via `claude mcp add --scope local`. `getSecretValue`/`getGlobalSecret` are NEVER registered as tools — the MCP surface is the second external boundary under the no-secrets invariant.

**Tech Stack:** `@modelcontextprotocol/sdk` (externalized, main-side), `node:http`/`node:crypto`, existing agent-core primitives, the `claude` CLI (shelled out), vitest, biome.

**Carry into every task:**
- ASCII-only comments in ALL `agent-core/*` and `app/src/main/*` files (CJS-bundled into Electron main; cjs_lexer crashes on multibyte).
- `@modelcontextprotocol/sdk` goes in `app/package.json` dependencies and stays EXTERNALIZED (do NOT add it to `electron.vite.config.ts`'s `exclude`) — bundling third-party code into `out/main` risks a cjs_lexer multibyte crash; externalized deps ship fine (node-pty proves it).
- THE INVARIANT: no MCP tool returns a secret value; `getSecretValue`/`getGlobalSecret` are never tool handlers. Every read tool returns metadata/status/names only. This gets the same adversarial review the IPC surface got.
- Live MCP connectivity (Claude Code actually connecting + calling tools) is a HUMAN GATE — only the owner can verify it. Subagents verify the unit-testable pieces (registration helper, ide-state, port/token, tool schemas, the security guard) + typecheck/lint/build/tests + that the server starts.

---

### Task 1: agent-core `claude mcp add` registration helper

**Files:** Create `packages/agent-core/src/mcp/register.ts`, `mcp/register.test.ts`; modify `packages/agent-core/src/index.ts`.

Mirror the `runGit`/`ghAccounts` execFile pattern (DI runner, ENOENT handling, cwd:root). ASCII-only.

- [ ] **Step 1: Failing tests** (register.test.ts) with a DI runner double:
  - `registerMcpServer({root, url, token}, run)` calls run with argv `["mcp","add","--transport","http","airlock", url, "--scope","local","--header", "Authorization: Bearer <token>"]` and `cwd: root`.
  - returns `{ ok: true }` on success.
  - returns `{ ok: true, alreadyExists: true }` if the runner throws an "already exists"-type error (tolerate re-registration).
  - returns `{ ok: false, reason: "not_found" }` when the runner throws an ENOENT-coded error (claude CLI missing).
  - other errors -> `{ ok: false, reason: "error", message }` (message scrubbed of the token: never echo the bearer token in an error).

- [ ] **Step 2: Implement** (ASCII comments):
```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface McpRegisterInput { root: string; url: string; token: string; name?: string; }
export type McpRegisterResult =
  | { ok: true; alreadyExists?: boolean }
  | { ok: false; reason: "not_found" | "error"; message?: string };

// DI runner: (argv, cwd) -> stdout. Real impl shells out to `claude`.
export type ClaudeRunner = (args: string[], cwd: string) => Promise<string>;

const realClaude: ClaudeRunner = async (args, cwd) => {
  const { stdout } = await exec("claude", args, { cwd, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
};

export async function registerMcpServer(
  input: McpRegisterInput,
  run: ClaudeRunner = realClaude,
): Promise<McpRegisterResult> {
  const name = input.name ?? "airlock";
  const args = [
    "mcp", "add", "--transport", "http", name, input.url,
    "--scope", "local",
    "--header", `Authorization: Bearer ${input.token}`,
  ];
  try {
    await run(args, input.root);
    return { ok: true };
  } catch (err) {
    const e = err as { code?: string; stderr?: string; message?: string };
    if (e.code === "ENOENT") return { ok: false, reason: "not_found" };
    const raw = e.stderr || e.message || "claude mcp add failed";
    // Never echo the bearer token in an error surfaced to logs/UI.
    const msg = raw.split(input.token).join("***");
    if (/already exists|already configured/i.test(msg)) return { ok: true, alreadyExists: true };
    return { ok: false, reason: "error", message: msg };
  }
}
```

- [ ] **Step 3:** Export `registerMcpServer`, `McpRegisterInput`, `McpRegisterResult`, `ClaudeRunner` from index.ts.
- [ ] **Step 4:** GREEN — `npm test`, typecheck, lint, build (agent-core CJS, ASCII). Commit — `feat(mcp): claude mcp add registration helper (agent-core, DI)`

---

### Task 2: Shared `ide-state` read layer + IPC refactor

**Files:** Create `packages/app/src/main/ide-state.ts`; modify `packages/app/src/main/ipc.ts` (refactor the status handlers to call it).

Extract each status-read handler body (Explore sec.3) into a function taking explicit params, so the IPC handler and (Task 5) the MCP tool share ONE implementation. ASCII-only. The IPC return shapes MUST be unchanged (the renderer must keep working).

- [ ] **Step 1: Create `ide-state.ts`** with these functions (move the bodies from ipc.ts verbatim, parameterizing on `root`/`prefsFile`):
```ts
// All MAIN-ONLY. None of these return a secret value (db uses parseConnString
// redacted projection; neon/render return metadata; secrets return names only).
import { /* the same agent-core imports ipc.ts uses */ } from "@airlock/agent-core";
import { loadPrefs } from "./prefs";
import { SECTIONS } from "./prefs";

export async function listSidebarSections(prefsFile: string): Promise<{ id: string; label: string; visible: boolean }[]>;
export async function databaseStatus(root: string): Promise<{ id: string; host: string; database: string; user: string; redacted: string; reachable: boolean | null }[]>;
//   = db:list projection, plus a per-entry withDb(pingDb) -> reachable (true/false), best-effort (null on error).
export async function dockerStatus(): Promise<{ installed: boolean; running: boolean; containers: { id: string; name: string; image: string; state: string; status: string }[] }>;  // = dockerContainers()
export async function neonStatus(): Promise<{ connected: boolean }>;                       // getGlobalSecret(NEON_KEY)!==null
export async function neonProjectsTree(): Promise<unknown>;  // projects (+ lazy branches/databases via separate fns mirroring ipc)
export async function renderServicesStatus(root: string | null): Promise<{ id: string; name: string; url: string; branch: string; deployStatus: string; deployed: boolean | null }[]>;  // = render:services body
export async function gitStatusFor(root: string): Promise<unknown>;                        // = gitStatus(root)
export async function hostStatus(root: string): Promise<{ url: string | null; up: boolean | null }>;  // = host:localUrl then probePort
export async function listSecretNames(root: string): Promise<{ name: string; provider: string | null; valid: boolean }[]>;  // = listSecrets(root) projection (NO values)
```
Keep the exact orchestration from ipc.ts (the render repo-filter + deploy-compare; the db redaction; the host url-resolve-then-probe). For `databaseStatus`, compose the `db:list` projection with a `withDb(...pingDb)` per entry to add `reachable` (the design's "SELECT 1 reachability"); never let a connection string escape (reuse `redactConnStrings` on errors). For `neon`, expose `neonStatus()` + the project/branch/database list fns mirroring the existing handlers (metadata only).

- [ ] **Step 2: Refactor `ipc.ts`** — each status handler now calls the matching `ide-state` function (passing `requireRoot()` / `workspaceRoot` / `prefsFile` as today). Example: `ipcMain.handle("git:status", () => gitStatusFor(requireRoot()))`, `ipcMain.handle("render:services", () => renderServicesStatus(workspaceRoot))`, etc. The `db:list`/`db:ping` handlers keep their CURRENT external shape (don't break the renderer): either keep them as-is and have `databaseStatus` compose `db:list`+ping internally, OR re-point them — but the renderer's `dbList()`/`dbPing()` responses must be byte-identical. Safest: leave db:list/db:ping handlers exactly as-is, and `databaseStatus` (for MCP) composes the same logic. Confirm typecheck + that the renderer IPC responses are unchanged.

- [ ] **Step 3:** typecheck + test (expect unchanged count) + lint + build. Commit — `refactor(main): extract ide-state read layer (shared by IPC + MCP)`

---

### Task 3: workspaceRoot accessor + onFolderOpen hook

**Files:** Modify `packages/app/src/main/ipc.ts` (export accessor + add callback), `packages/app/src/main/index.ts` (pass the callback).

- [ ] **Step 1: ipc.ts** — export `getWorkspaceRoot(): string | null` (returns the module `workspaceRoot`). Extend `registerIpc(getBaseEnv, prefsFile, onFolderOpen?)` with an optional `onFolderOpen?: (root: string) => void`; call it inside `dialog:openFolder` after `workspaceRoot` is set:
```ts
ipcMain.handle("dialog:openFolder", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (r.canceled || r.filePaths.length === 0) return null;
  workspaceRoot = r.filePaths[0] ?? null;
  if (workspaceRoot) onFolderOpen?.(workspaceRoot);
  return workspaceRoot;
});
```
- [ ] **Step 2: index.ts** — for now pass a placeholder `onFolderOpen` that Task 6 fills in (the MCP re-registration). Keep the existing `registerIpc(() => loginEnv, prefsFile)` call working (the new param is optional). typecheck/build. Commit — `feat(main): workspaceRoot accessor + onFolderOpen hook`

---

### Task 4: MCP server skeleton + transport + lifecycle + port/token

**Files:** Create `packages/app/src/main/mcp/server.ts`; modify `packages/app/src/main/index.ts` (start/stop), `packages/app/src/main/prefs.ts` (persist mcp `{port, token}`), `packages/app/package.json` (add SDK dep).

- [ ] **Step 1: Add the SDK** — `npm i -w @airlock/app @modelcontextprotocol/sdk`. Do NOT add it to the vite `exclude` (keep externalized). Confirm `npm run build` still bundles main with no cjs_lexer error.

- [ ] **Step 2: Persist `{port, token}`** in prefs.json (app-global, stable across launches). Add to `AppPrefs` (shared/ipc.ts) an optional `mcp?: { port: number; token: string }`; sanitize it in prefs.ts (allowlist). On first server start, if absent, generate `token = crypto.randomBytes(24).toString("hex")` and pick a default `port` (e.g. 4319); persist. (A stable port keeps the registered Claude Code URL valid across launches.)

- [ ] **Step 3: `mcp/server.ts`** (ASCII comments). Build an McpServer, bind `127.0.0.1:<port>` with a bearer-token gate, wire the SDK streamable-HTTP transport over a `node:http` server. Skeleton (adapt to the installed SDK version's transport API — use `StreamableHTTPServerTransport` if present):
```ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// import the SDK's streamable-http server transport (check the installed version path)

export interface McpDeps {
  prefsFile: string;
  getWorkspaceRoot: () => string | null;
  token: string;
}

let httpServer: ReturnType<typeof createServer> | null = null;

export async function startMcpServer(port: number, deps: McpDeps): Promise<void> {
  const mcp = new McpServer({ name: "airlock", version: "1.0.0" });
  // Task 5 registers tools on `mcp`; Task 6 registers resources.
  registerTools(mcp, deps);     // Task 5
  registerResources(mcp);       // Task 6
  // Wire transport: a node:http server bound to 127.0.0.1, bearer-checked.
  httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${deps.token}`) { res.statusCode = 401; res.end("unauthorized"); return; }
    // hand req/res to the SDK transport (per the installed SDK API)
  });
  await new Promise<void>((resolve) => httpServer?.listen(port, "127.0.0.1", resolve));
}

export async function stopMcpServer(): Promise<void> {
  await new Promise<void>((r) => (httpServer ? httpServer.close(() => r()) : r()));
  httpServer = null;
}
```
(The exact transport wiring depends on the SDK version — the implementer reads the installed `@modelcontextprotocol/sdk` to use its current streamable-HTTP server transport. Bind 127.0.0.1 ONLY; reject any request whose Authorization header != the bearer token.)

- [ ] **Step 4: Lifecycle in index.ts** — after `applyAppMenu(...)` in `whenReady`: load/generate `{port, token}`, `await startMcpServer(port, { prefsFile, getWorkspaceRoot, token })`. Add `app.on("before-quit", () => { void stopMcpServer(); })` alongside `killAllSessions`. The server lives across window-close (darwin) and only stops on quit.

- [ ] **Step 5:** typecheck + build (no cjs_lexer error; confirm the externalized SDK resolves) + lint. A unit test for the port/token generation + persistence (prefs sanitize of `mcp`). Commit — `feat(mcp): MCP HTTP server skeleton + lifecycle + port/token`

---

### Task 5: MCP tools (read + UI-control) + the security guard

**Files:** Create `packages/app/src/main/mcp/tools.ts` (the `registerTools` from Task 4); test `packages/app/src/main/mcp/tools.test.ts`.

- [ ] **Step 1: Register the tools** on the McpServer, each wrapping an `ide-state` function or `changeSectionVisibility`. ASCII comments. Imperative names, return the result as JSON text, mutating tool returns new state:
```ts
import { changeSectionVisibility } from "../menu";
import { SECTIONS } from "../prefs";
import * as ide from "../ide-state";
// list_sidebar_sections, set_sidebar_section_visibility(section, visible),
// database_status, docker_status, neon_status, render_services,
// git_status, host_status, list_secret_names
```
For `set_sidebar_section_visibility`: validate `section` against `SECTIONS` (reject otherwise), call `changeSectionVisibility(deps.prefsFile, section, visible)`, return the new visibility map. For root-scoped reads, resolve `deps.getWorkspaceRoot()` and return a clean "no workspace open" error if null. Each tool's description is one line and notes side effects for the mutator.

- [ ] **Step 2: THE SECURITY GUARD.** Add an explicit, tested registry assertion: a unit test enumerates the registered tool names and asserts the set is EXACTLY the 9 allowed tools — and that none of `getSecretValue`, `getGlobalSecret`, `dbConnString`, `injectInto`, `neonConnectionUri` is reachable from any tool. (A literal allowlist test so a future tool addition that leaks a value fails CI.)

- [ ] **Step 3: Tests** for the pure pieces: the `section` validation (rejects non-SECTIONS), the tool registry allowlist (exactly the 9, no value-returning fn imported), and that `set_sidebar_section_visibility` calls `changeSectionVisibility` with validated args (DI/spy). typecheck/test/lint/build. Commit — `feat(mcp): read + UI-control tools + tool-allowlist guard test`

---

### Task 6: MCP resources (the .md manual) + bundling + registration call

**Files:** Create `packages/app/resources/mcp-docs/*.md` (the manual), `packages/app/src/main/mcp/resources.ts` (`registerResources` + path resolution); modify `packages/app/package.json` (electron-builder `extraResources`), `packages/app/src/main/index.ts` (fill in `onFolderOpen` -> registerMcpServer).

- [ ] **Step 1: Author the manual** under `packages/app/resources/mcp-docs/` (non-gitignored): `overview.md`, `sidebar-files.md`, `sidebar-secrets.md`, `sidebar-git.md`, `sidebar-databases.md`, `sidebar-docker.md`, `sidebar-host.md`, `sidebar-audit.md`, `tools.md`, `security-model.md`. Each `sidebar-*.md`: what the section shows + when it is useful for a project (so Claude can curate). `security-model.md`: the no-secrets invariant (Claude cannot/should not reach for values).

- [ ] **Step 2: `resources.ts`** — resolve the docs dir via `app.isPackaged ? path.join(process.resourcesPath, "mcp-docs") : path.join(__dirname, "../../resources/mcp-docs")` (mirror the icon `app.isPackaged` branch in index.ts). Register each `.md` as an MCP resource (`airlock:file://docs/<name>`) with `resources/list` + `resources/read` reading the file as `text/markdown`. ASCII comments (this is main).

- [ ] **Step 3: Ship the docs** — add to `app/package.json` electron-builder: `"extraResources": [{ "from": "resources/mcp-docs", "to": "mcp-docs" }]` so the packaged `.app` has them at `process.resourcesPath/mcp-docs`.

- [ ] **Step 4: Registration call** — in index.ts, set `onFolderOpen = (root) => { void registerMcpServer({ root, url: `http://127.0.0.1:${port}/mcp`, token }).then(r => { if (!r.ok && r.reason === "not_found") log a one-time hint with the exact `claude mcp add` command }); }` and pass it to `registerIpc(() => loginEnv, prefsFile, onFolderOpen)`. (Register on folder-open so it is keyed to the project dir via `cwd`.)

- [ ] **Step 5:** typecheck/test/lint/build + `npm run package` (confirm `mcp-docs` lands in the `.app`; do NOT launch). Commit — `feat(mcp): IDE-manual resources + local-scope registration on folder open`

---

### Task 7: Docs + verify + repackage + gate

**Files:** Modify the dedicated spec status, the v1 design spec (dated note), `README.md`.

- [ ] **Step 1:** Flip `2026-06-04-mcp-ide-bridge-design.md` Status to "v1 complete." Add a dated note to the v1 design spec (2026-06-04, MCP IDE-bridge: airlock as a local MCP server; the terminal Claude gains IDE resources + status reads + sidebar control; no embedded agent; the MCP surface is the second no-secrets boundary; local-scope registration). README: a "Claude in the terminal can drive airlock" section (what it can see/do, the security boundary, that you approve the server + tools in Claude Code on first use).
- [ ] **Step 2: Full verify (report each):** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run package` (electron-builder --dir; do NOT launch — owner's app holds the lock). Confirm `.app` mtime advances + `mcp-docs` is inside the bundle.
- [ ] **Step 3: Commit (NO tag)** — `docs: MCP IDE-bridge (v1) complete; repackaged`
- [ ] **Step 4:** HUMAN GATE — owner relaunches airlock, opens a project, and in the terminal: Claude Code prompts to approve the `airlock` MCP server; `@airlock:` resources are available; ask Claude "what's the status of my databases / set up my sidebar for this project" -> it calls the read tools + `set_sidebar_section_visibility` and the sidebar updates live; confirm there is NO tool that returns a secret value.

---

## Self-review notes
- Spec coverage: registration helper (T1), shared read layer (T2), workspaceRoot wiring (T3), server+transport+lifecycle+port/token (T4), tools+security-guard (T5), resources+bundling+registration (T6), docs+gate (T7). Covered.
- Security: no tool returns a secret value; the allowlist guard test (T5) locks it; getSecretValue/getGlobalSecret never tool handlers; 127.0.0.1 bind + bearer token; registration never echoes the token. The MCP surface mirrors the IPC surface's no-secrets discipline.
- Reuse: changeSectionVisibility (UI control), the agent-core status primitives, the runGit/ghAccounts execFile pattern (registration), the app.isPackaged path branch (resources). New: the SDK + HTTP server + ide-state extraction.
- Risk: the ide-state extraction (T2) must not change IPC response shapes — verified by typecheck + the live gate. Live MCP connectivity is the human gate (subagents can't run Claude Code against the server).
