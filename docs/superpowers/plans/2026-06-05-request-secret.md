# request_secret Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a `request_secret` MCP tool: the terminal Claude asks the user to vault a secret it needs; airlock opens the secure modal (name pre-filled), the user saves the value (straight to the keychain), and the agent gets back ONLY whether it was vaulted -- never the value.

**Architecture:** A new main-side resolver module (`agent-requests.ts`): `requestSecretFromUser(name, hint)` pushes `agent:request-secret` to the renderer and returns a promise resolved (by `requestId`) when the renderer reports the outcome via `agent:request-secret-resolved`, with a ~5min timeout and single-in-flight (busy otherwise). The MCP tool (root-gated) calls this dep and returns the boolean. The renderer opens the existing SecretModal in an "agent-requested" mode (name pre-filled + locked, a "Claude is requesting this" note), vaults via the existing `secretsSet` path, and reports save/cancel back. NO value path to the agent.

**Carry into every task:**
- ASCII-only comments + string literals in agent-core/* and app/src/main/* (CJS-bundled into Electron main). The renderer (SecretModal/store/App/hook) is exempt. The new tool's `description` string is main-bundled -> ASCII.
- THE INVARIANT (trivial here): `request_secret` never returns/reads/touches a value. The value flows user -> keychain via the existing `secretsSet`/`setSecret`. The tool result is a boolean. `tools.ts` must still reference none of getSecretValue/getGlobalSecret/neonConnectionUri/dbConnString/injectInto (source-guard).
- Single in-flight: a 2nd request while one is pending returns `{vaulted:false, busy:true}` (do not stack modals). Timeout -> `{vaulted:false, timedOut:true}`.
- Agent-mode resolves `vaulted:true` whenever `secretsSet` RESOLVES (even meta.valid:false -- the keychain write happens regardless; do not strand the agent on the invalid-warning branch).

---

### Task 1: main resolver module + IPC + index wiring

**Files:** Create `packages/app/src/main/agent-requests.ts`, `agent-requests.test.ts`; modify `packages/app/src/main/index.ts`.

- [ ] **Step 1: agent-requests.ts** (ASCII-only). DI the renderer notify so the resolver/timeout/busy logic is unit-testable:
```ts
import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain } from "electron";

export interface SecretRequestResult { vaulted: boolean; timedOut?: boolean; busy?: boolean; }

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const pending = new Map<string, { resolve: (r: SecretRequestResult) => void; timer: ReturnType<typeof setTimeout> }>();

// DI seam: how we tell the renderer to open the modal. Returns false if there
// is no live window to ask.
export type RequestNotifier = (payload: { requestId: string; name: string; providerHint?: string }) => boolean;

const realNotify: RequestNotifier = (payload) => {
  const wc = BrowserWindow.getAllWindows()[0]?.webContents;
  if (!wc || wc.isDestroyed()) return false;
  wc.send("agent:request-secret", payload);
  return true;
};

// MAIN-ONLY: ask the user to vault a secret. Opens the modal and awaits the
// user's save/cancel. NEVER returns or handles a value -- the value goes
// user -> keychain via secretsSet; this resolves only a boolean.
export function requestSecretFromUser(
  name: string,
  providerHint?: string,
  notify: RequestNotifier = realNotify,
): Promise<SecretRequestResult> {
  if (pending.size > 0) return Promise.resolve({ vaulted: false, busy: true });
  const requestId = randomUUID();
  if (!notify({ requestId, name, providerHint })) {
    return Promise.resolve({ vaulted: false });
  }
  return new Promise<SecretRequestResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ vaulted: false, timedOut: true });
    }, REQUEST_TIMEOUT_MS);
    pending.set(requestId, { resolve, timer });
  });
}

// Resolve a pending request (called from the renderer-resolved IPC).
export function resolveSecretRequest(requestId: string, vaulted: boolean): void {
  const p = pending.get(requestId);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(requestId);
  p.resolve({ vaulted });
}

export function registerAgentRequestIpc(): void {
  ipcMain.handle("agent:request-secret-resolved", (_e, requestId: unknown, vaulted: unknown) => {
    if (typeof requestId !== "string" || typeof vaulted !== "boolean") {
      throw new Error("Invalid payload");
    }
    resolveSecretRequest(requestId, vaulted);
  });
}
```

- [ ] **Step 2: tests (agent-requests.test.ts)** with a fake notifier (records payloads):
  - notify called once with {requestId, name, providerHint}; the requestId is a non-empty string.
  - resolveSecretRequest(requestId, true) -> the promise resolves `{vaulted:true}`; resolveSecretRequest(id,false) -> `{vaulted:false}`.
  - a 2nd requestSecretFromUser while the 1st is pending -> resolves `{vaulted:false, busy:true}` and the notifier is NOT called the 2nd time.
  - notifier returns false (no window) -> `{vaulted:false}`, no pending entry left.
  - timeout (use vitest fake timers): after REQUEST_TIMEOUT_MS with no resolve -> `{vaulted:false, timedOut:true}`, pending cleared.
  (Test the exported functions directly; `registerAgentRequestIpc` is thin electron glue -- it can stay untested or be lightly checked.)

- [ ] **Step 3: index.ts** -- import `registerAgentRequestIpc`, `requestSecretFromUser` from "./agent-requests"; call `registerAgentRequestIpc()` in whenReady (near `registerIpc(...)`, before startMcpServer); add `requestSecretFromUser` to the startMcpServer deps object.

- [ ] **Step 4: GREEN** -- `npm test`, typecheck, lint, build (main CJS, no cjs_lexer). Commit -- `feat(agent): requestSecretFromUser resolver (main-side, never handles a value)`

---

### Task 2: request_secret MCP tool + deps wiring

**Files:** Modify `packages/app/src/main/mcp/server.ts`, `mcp/tools.ts`, `mcp/tools.test.ts`.

- [ ] **Step 1: server.ts** -- McpDeps += `requestSecretFromUser: (name: string, providerHint?: string) => Promise<{ vaulted: boolean; timedOut?: boolean; busy?: boolean }>`; createMcpServer forwards it into registerTools (alongside prefsFile/getWorkspaceRoot/getBaseEnv). Update the stale "nine/ten v1 tools" comments to eleven (ASCII).
- [ ] **Step 2: tools.ts** -- ToolDeps += the same `requestSecretFromUser`. Add `"request_secret"` to TOOL_NAMES (now 11). Register (root-gated; calls ONLY the dep -- no value-path import):
```ts
mcp.registerTool(
  "request_secret",
  {
    description:
      "Ask the user to vault a secret you need (it opens a secure prompt). Returns only whether it was vaulted -- you never see the value. Use after a tool reports a secret is not vaulted.",
    inputSchema: {
      name: z.string(),
      providerHint: z.string().optional(),
    },
  },
  async ({ name, providerHint }) => {
    const root = deps.getWorkspaceRoot();
    if (!root) return err(NO_WORKSPACE);
    return ok(await deps.requestSecretFromUser(name, providerHint));
  },
);
```
- [ ] **Step 3: tools.test.ts** -- `baseDeps` += `requestSecretFromUser: vi.fn(async () => ({ vaulted: true }))`; the allowlist `toHaveLength(10)` -> `11` + update the prose/title; confirm "request_secret" is in the set; the FORBIDDEN source-guard MUST still pass (tools.ts references the dep, not getSecretValue). Add a no-workspace test: getWorkspaceRoot()->null returns err(NO_WORKSPACE) and `requestSecretFromUser` is NOT called.
- [ ] **Step 4: GREEN** -- typecheck, test (allowlist 11, source-guard green), lint, build (no cjs_lexer; SDK externalized). Commit -- `feat(mcp): request_secret tool + requestSecretFromUser dep`

---

### Task 3: renderer agent-requested modal flow

**Files:** Modify `packages/app/src/renderer/src/store.ts`, `App.tsx`, `components/SecretModal.tsx`, `lib/usePrefs.ts` (or a new hook); `packages/app/src/preload/index.ts`; `packages/app/src/shared/ipc.ts`.

- [ ] **Step 1: shared/ipc.ts + preload** -- add to AirlockApi: `onRequestSecret(cb: (p: { requestId: string; name: string; providerHint?: string }) => void): () => void;` and `requestSecretResolve(requestId: string, vaulted: boolean): Promise<void>;`. preload: `onRequestSecret: (cb) => subscribe<...>("agent:request-secret", cb)` and `requestSecretResolve: (requestId, vaulted) => ipcRenderer.invoke("agent:request-secret-resolved", requestId, vaulted)`.
- [ ] **Step 2: store.ts** -- extend the `modal` union with `| { requestSecret: { requestId: string; name: string; providerHint?: string } }`.
- [ ] **Step 3: subscribe** -- in usePrefs.ts (or a new `useAgentRequests` called from App), add an effect: `return window.airlock.onRequestSecret((p) => useApp.getState().setModal({ requestSecret: p }));`.
- [ ] **Step 4: App.tsx** -- the modal mount must handle the new variant. Make the guard/key explicit so SecretModal renders for it and remounts per request:
```tsx
{(modal === "add-secret" ||
  (typeof modal === "object" && modal !== null)) && (
  <SecretModal
    key={
      typeof modal === "string"
        ? modal
        : "requestSecret" in modal ? modal.requestSecret.requestId : modal.update
    }
  />
)}
```
- [ ] **Step 5: SecretModal.tsx** -- add agent-requested mode (unicode OK here):
  - Derive `const requested = (typeof modal === "object" && modal !== null && "requestSecret" in modal) ? modal.requestSecret : null;`
  - Pre-fill + lock the name when `requested`: `useState(requested?.name ?? updating ?? "")`; render the name input `readOnly` when `requested`.
  - Show a note when `requested`: "Claude is requesting this secret to use on your behalf. It is vaulted in your keychain -- Claude never sees the value." + the `requested.providerHint` if present.
  - On successful `secretsSet` (resolves, regardless of meta.valid): if `requested`, call `await window.airlock.requestSecretResolve(requested.requestId, true)` then `setSecrets(...)` + `setModal(null)` (do NOT keep the modal open on !valid in requested mode -- the agent is waiting; the secret IS vaulted).
  - On Cancel AND on backdrop-click AND on Escape: if `requested`, call `window.airlock.requestSecretResolve(requested.requestId, false)` before `setModal(null)`. (Add the backdrop onClick + an Escape keydown effect for requested mode; non-requested behavior unchanged.)
- [ ] **Step 6: GREEN** -- typecheck, test, lint, build. Commit -- `feat(renderer): agent-requested secret modal (resolves request_secret)`

---

### Task 4: Docs + verify + repackage + gate

**Files:** Modify mcp-docs `tools.md` + `security-model.md`, the request_secret spec status, the v1 design spec (dated note), README.

- [ ] **Step 1: MCP docs** -- tools.md: add `request_secret` (ask the user to vault a secret you need; you never see the value; use it after a "not vaulted" failure, then retry). security-model.md: note request_secret never touches a value (user -> keychain only). Flip the request_secret spec Status to "v1 complete."
- [ ] **Step 2: v1 design spec** -- dated note (2026-06-05, request_secret: agent asks the user to vault a needed secret via the secure modal; resolver round-trip with timeout + single-in-flight; the agent gets a boolean, never the value). README: a one-line blurb.
- [ ] **Step 3: Full verify** -- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run package` (--dir, do NOT launch). Confirm `.app` mtime advances.
- [ ] **Step 4: Commit (NO tag)** -- `docs: request_secret (v1) complete; repackaged`
- [ ] **Step 5:** HUMAN GATE -- owner relaunches, reconnects; asks the terminal Claude something that needs an un-vaulted secret (or directly "use request_secret to ask me for STRIPE_KEY") -> the secure modal pops with the name pre-filled + the "Claude is requesting" note -> owner saves -> the agent reports vaulted:true and the value never reaches it; owner cancels another -> agent gets vaulted:false.

---

## Self-review notes
- Spec coverage: resolver+IPC+wiring (T1), the MCP tool+deps (T2), the renderer modal round-trip (T3), docs+gate (T4). Covered.
- Security: no value path to the agent (value: user -> keychain via secretsSet; tool returns a boolean); source-guard stays green; root-gated; single-in-flight + timeout so the agent never hangs forever.
- Reuse: the secretsSet/setSecret vault path (unchanged), the sections:changed push pattern, the subscribe<T> preload helper, the SecretModal, the ok()/err()/NO_WORKSPACE tool helpers.
- Live round-trip (modal pops, user saves, agent proceeds) is the human gate; the resolver logic (busy/timeout/resolve) is unit-tested with a fake notifier.
