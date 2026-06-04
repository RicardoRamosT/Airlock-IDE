# Neon in Databases (Slice A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Vault an app-global Neon API key, then browse Neon projects -> branches -> databases in the Databases section, reusing the existing live-dot / tables / read-only data-grid. Connection strings are fetched from Neon's API main-side and never exposed to the renderer or agent.

**Architecture:** A new app-global credential namespace in the broker (`@global/<name>` keychain accounts; main-only `getGlobalSecret`/`setGlobalSecret`, audited to a userData-level chain). A new electron-free Neon API client in agent-core (DI'd transport + pure parsers). Main-side `neon:*` IPC resolves a per-branch connection URI on demand (main-only, never returned) and reuses the existing `withDb`/`pingDb`/`listTables`/`readRows`. The renderer gets metadata + rows only. The `dbView` viewer target becomes a discriminated union so a Neon table opens in the same DataGrid; "Connect Neon" is a small dedicated modal.

**Tech Stack:** @napi-rs/keyring (existing), global `fetch` (Electron main, no new dep), pg via existing `withDb`, React/Zustand renderer, vitest, biome.

**Carry into every task:**
- ASCII-only comments in ALL `agent-core/*` and `app/src/main/*` files (CJS-bundled into Electron main; multibyte crashes the cjs_lexer).
- Neon connection URIs contain passwords. They are resolved MAIN-ONLY and NEVER returned over IPC; all `neon:*` error paths run through `redactConnStrings` (already exported from agent-core), and rethrows use a fresh `Error` with NO `cause` (same discipline as `db:*`).
- `neon:*` handlers are app-global: NOT `requireRoot`-gated (Neon is account-level; works with no folder open).
- The Neon key is the global secret named `NEON_API_KEY`.
- Reuse, do not reinvent: `withDb` already SSL-matches `neon.tech`; `pingDb`/`listTables`/`readRows` are reused verbatim.

---

### Task 1: Broker app-global secrets + audit generalization

**Files:**
- Modify: `packages/agent-core/src/audit/audit.ts` (appendAudit ~58-84)
- Modify: `packages/agent-core/src/broker/broker.ts` (near getSecretValue ~101)
- Modify: `packages/agent-core/src/index.ts` (exports)
- Test: `packages/agent-core/src/broker/broker.test.ts`, `packages/agent-core/src/audit/audit.test.ts`

- [ ] **Step 1: Generalize audit.** Refactor `appendAudit` so the chain logic lives in a path-taking helper. Add (ASCII comments):
```ts
// Append one hash-chained entry to a SPECIFIC log file. appendAudit() is the
// project-rooted wrapper; app-global events (e.g. global credential writes)
// use their own chain via this.
export async function appendAuditAt(
  logFile: string,
  actor: AuditEntry["actor"],
  op: string,
  detail: Record<string, unknown>,
  nowIso?: string,
): Promise<AuditEntry> {
  // ... move the existing appendAudit body here, using `logFile` instead of
  // the root-derived path (read prior entries from logFile, link prevHash,
  // sha256 over {ts,actor,op,detail,prevHash}, append one JSONL line) ...
}

export async function appendAudit(
  root: string,
  actor: AuditEntry["actor"],
  op: string,
  detail: Record<string, unknown>,
  nowIso?: string,
): Promise<AuditEntry> {
  return appendAuditAt(auditPathFor(root), actor, op, detail, nowIso);
}
```
where `auditPathFor(root)` is the existing `${root}/.airlock/audit/log.jsonl` derivation (extract it into a small local helper if not already one). Behavior of the existing `appendAudit(root, ...)` must be UNCHANGED.

- [ ] **Step 2: Failing audit test** - `appendAuditAt(tmpfile, "user", "x.y", {a:1})` writes a parseable chained entry; a second call links `prevHash` to the first's `hash`. Existing appendAudit tests must still pass. Run `npm test -- audit` -> RED for the new case.

- [ ] **Step 3: Broker global secrets** (broker.ts). Import `appendAuditAt`. Add (ASCII comments, mirror the getSecretValue security banner):
```ts
// Reserved app-global keychain namespace. accountFor() yields "<id>:<name>"
// where id is "<basename>-<8hex>" -- it never starts with "@" nor contains
// "/", so "@global/<name>" can never collide with a project secret account.
function globalAccountFor(name: string): string {
  return `@global/${name}`;
}

// MAIN-ONLY app-global secret read. SAME hard rule as getSecretValue: NEVER
// register as an agent tool, NEVER return over renderer IPC. For account-level
// API keys (Neon, Render) that are not tied to one project.
export async function getGlobalSecret(
  name: string,
  opts: BrokerOptions = {},
): Promise<string | null> {
  const keychain = opts.keychain ?? systemKeychain;
  return keychain.get(SERVICE, globalAccountFor(name));
}

// Vault an app-global secret. Write-only from the renderer's view (the value
// never comes back). Audited to the app-global chain when auditLog is given.
export async function setGlobalSecret(
  name: string,
  value: string,
  opts: BrokerOptions & { auditLog?: string } = {},
): Promise<void> {
  const keychain = opts.keychain ?? systemKeychain;
  if (!value) throw new Error("Empty secret value");
  keychain.set(SERVICE, globalAccountFor(name), value);
  if (opts.auditLog) {
    await appendAuditAt(opts.auditLog, "user", "secret.global.set", { name });
  }
}
```

- [ ] **Step 4: Failing broker test** (broker.test.ts) using the DI keychain (follow the existing in-memory KeychainStore test double): `setGlobalSecret("NEON_API_KEY","v",{keychain})` then `getGlobalSecret("NEON_API_KEY",{keychain})` round-trips "v"; `getGlobalSecret` of an unset name -> null; the account used is `@global/NEON_API_KEY` (assert the test double saw that account, proving no project collision); empty value throws; with `auditLog` set (a tmp file) a `secret.global.set` entry is appended. RED first.

- [ ] **Step 5: Export** from index.ts: `getGlobalSecret`, `setGlobalSecret`, `appendAuditAt`.

- [ ] **Step 6: GREEN** - `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` (build matters: agent-core CJS-bundles; confirm ASCII). 

- [ ] **Step 7: Commit** - `feat(broker): app-global secrets (Neon/Render keys) + audit-at-path`

---

### Task 2: Neon API client (agent-core)

**Files:**
- Create: `packages/agent-core/src/neon/client.ts`, `packages/agent-core/src/neon/parse.ts`
- Modify: `packages/agent-core/src/index.ts` (exports)
- Test: `packages/agent-core/src/neon/parse.test.ts`

- [ ] **Step 1: Failing parser tests** (parse.test.ts) against representative Neon API JSON:
  - `parseProjects({projects:[{id:"p1",name:"prod"},{id:"p2",name:"dev"}]})` -> `[{id:"p1",name:"prod"},{id:"p2",name:"dev"}]`
  - `parseBranches({branches:[{id:"br-1",name:"main"}]})` -> `[{id:"br-1",name:"main"}]`
  - `parseDatabases({databases:[{name:"neondb",owner_name:"neondb_owner"}]})` -> `[{name:"neondb",ownerName:"neondb_owner"}]`
  - `parseConnectionUri({uri:"postgres://u:p@h/db"})` -> `"postgres://u:p@h/db"`
  - Each tolerant of a missing/empty array (-> `[]`) and missing optional fields; `parseConnectionUri` throws if `uri` absent. RED first.

- [ ] **Step 2: Implement parsers** (parse.ts, ASCII comments):
```ts
import type { NeonBranch, NeonDatabase, NeonProject } from "./client";

function arr(json: unknown, key: string): Record<string, unknown>[] {
  if (json && typeof json === "object") {
    const v = (json as Record<string, unknown>)[key];
    if (Array.isArray(v)) return v as Record<string, unknown>[];
  }
  return [];
}
const str = (o: Record<string, unknown>, k: string): string =>
  typeof o[k] === "string" ? (o[k] as string) : "";

export function parseProjects(json: unknown): NeonProject[] {
  return arr(json, "projects").map((p) => ({ id: str(p, "id"), name: str(p, "name") }));
}
export function parseBranches(json: unknown): NeonBranch[] {
  return arr(json, "branches").map((b) => ({ id: str(b, "id"), name: str(b, "name") }));
}
export function parseDatabases(json: unknown): NeonDatabase[] {
  return arr(json, "databases").map((d) => ({ name: str(d, "name"), ownerName: str(d, "owner_name") }));
}
export function parseConnectionUri(json: unknown): string {
  if (json && typeof json === "object") {
    const uri = (json as Record<string, unknown>).uri;
    if (typeof uri === "string" && uri) return uri;
  }
  throw new Error("Neon connection_uri missing");
}
```

- [ ] **Step 3: Implement client** (client.ts, ASCII comments):
```ts
import { parseBranches, parseConnectionUri, parseDatabases, parseProjects } from "./parse";

const NEON_API_BASE = "https://console.neon.tech/api/v2";

export interface NeonProject { id: string; name: string; }
export interface NeonBranch { id: string; name: string; }
export interface NeonDatabase { name: string; ownerName: string; }

// DI transport so the HTTP edge is swappable in tests. The real adapter uses
// the global fetch in the Electron/Node main process.
export interface NeonTransport {
  get(path: string, key: string): Promise<unknown>;
}
export interface NeonOptions { transport?: NeonTransport; }

export const fetchTransport: NeonTransport = {
  async get(path, key) {
    const res = await fetch(`${NEON_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Neon API ${res.status} ${res.statusText}`);
    return res.json();
  },
};

const enc = encodeURIComponent;

export async function listProjects(key: string, opts: NeonOptions = {}): Promise<NeonProject[]> {
  const t = opts.transport ?? fetchTransport;
  return parseProjects(await t.get("/projects", key));
}
export async function listBranches(key: string, projectId: string, opts: NeonOptions = {}): Promise<NeonBranch[]> {
  const t = opts.transport ?? fetchTransport;
  return parseBranches(await t.get(`/projects/${enc(projectId)}/branches`, key));
}
export async function listDatabases(key: string, projectId: string, branchId: string, opts: NeonOptions = {}): Promise<NeonDatabase[]> {
  const t = opts.transport ?? fetchTransport;
  return parseDatabases(await t.get(`/projects/${enc(projectId)}/branches/${enc(branchId)}/databases`, key));
}
// MAIN-ONLY: returns a connstring WITH password. NEVER return this over IPC.
export async function neonConnectionUri(
  key: string, projectId: string, branchId: string, database: string, role: string, opts: NeonOptions = {},
): Promise<string> {
  const t = opts.transport ?? fetchTransport;
  const q = new URLSearchParams({ branch_id: branchId, database_name: database, role_name: role, pooled: "false" });
  return parseConnectionUri(await t.get(`/projects/${enc(projectId)}/connection_uri?${q.toString()}`, key));
}
```

- [ ] **Step 4: Export** from index.ts: the four functions + `NeonProject`/`NeonBranch`/`NeonDatabase` types + `fetchTransport`/`NeonTransport`/`NeonOptions`.
- [ ] **Step 5: GREEN** - `npm test` (parsers pass), typecheck, lint, build.
- [ ] **Step 6: Commit** - `feat(neon): agent-core Neon API client (DI transport, pure parsers)`

---

### Task 3: Neon IPC (main)

**Files:**
- Modify: `packages/app/src/main/ipc.ts` (after the db:* handlers ~331; registerIpc ~60)

- [ ] **Step 1: Add imports + helpers.** Import from `@airlock/agent-core`: `getGlobalSecret`, `setGlobalSecret`, `listProjects`, `listBranches`, `listDatabases`, `neonConnectionUri`. Ensure `node:path` is imported. In `registerIpc`, compute once:
```ts
  // App-global audit chain (userData-level), for global credential writes.
  const globalAuditLog = prefsFile
    ? path.join(path.dirname(prefsFile), "audit-global.jsonl")
    : "";
```
Add module-level helpers (ASCII comments):
```ts
const NEON_KEY = "NEON_API_KEY";

// MAIN-ONLY: resolve a Neon branch/db connection URI (carries a password).
// NEVER returned over IPC -- used only to feed withDb here.
async function neonUri(p: string, b: string, db: string, role: string): Promise<string> {
  const key = await getGlobalSecret(NEON_KEY);
  if (!key) throw new Error("Neon not connected");
  return neonConnectionUri(key, p, b, db, role);
}
const allStr = (xs: unknown[]): boolean => xs.every((x) => typeof x === "string");
```

- [ ] **Step 2: Add handlers** (NOT requireRoot-gated; mirror db:* scrub discipline):
```ts
  // Neon: app-global (account-level), so NOT requireRoot-gated. The API key
  // and any fetched connection URI stay main-only; only metadata/rows cross.
  ipcMain.handle("neon:status", async () => ({
    connected: (await getGlobalSecret(NEON_KEY)) !== null,
  }));
  ipcMain.handle("neon:connect", async (_e, key: unknown) => {
    if (typeof key !== "string" || !key.trim()) throw new Error("Invalid payload");
    await setGlobalSecret(NEON_KEY, key.trim(), { auditLog: globalAuditLog });
    return { connected: true };
  });
  ipcMain.handle("neon:projects", async () => {
    const key = await getGlobalSecret(NEON_KEY);
    if (!key) throw new Error("Neon not connected");
    return listProjects(key);
  });
  ipcMain.handle("neon:branches", async (_e, p: unknown) => {
    if (typeof p !== "string") throw new Error("Invalid payload");
    const key = await getGlobalSecret(NEON_KEY);
    if (!key) throw new Error("Neon not connected");
    return listBranches(key, p);
  });
  ipcMain.handle("neon:databases", async (_e, p: unknown, b: unknown) => {
    if (!allStr([p, b])) throw new Error("Invalid payload");
    const key = await getGlobalSecret(NEON_KEY);
    if (!key) throw new Error("Neon not connected");
    return listDatabases(key, p as string, b as string);
  });
  ipcMain.handle("neon:ping", async (_e, p, b, db, role) => {
    if (!allStr([p, b, db, role])) throw new Error("Invalid payload");
    try {
      await withDb(await neonUri(p, b, db, role), (run) => pingDb(run));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: redactConnStrings(err instanceof Error ? err.message : String(err)) };
    }
  });
  ipcMain.handle("neon:tables", async (_e, p, b, db, role) => {
    if (!allStr([p, b, db, role])) throw new Error("Invalid payload");
    try {
      return await withDb(await neonUri(p, b, db, role), (run) => listTables(run));
    } catch (err) {
      throw new Error(redactConnStrings(err instanceof Error ? err.message : String(err)));
    }
  });
  ipcMain.handle("neon:rows", async (_e, p, b, db, role, schema, table, limit) => {
    if (!allStr([p, b, db, role, schema, table])) throw new Error("Invalid payload");
    const lim = typeof limit === "number" ? limit : 100;
    try {
      return await withDb(await neonUri(p, b, db, role), (run) => readRows(run, schema as string, table as string, lim));
    } catch (err) {
      throw new Error(redactConnStrings(err instanceof Error ? err.message : String(err)));
    }
  });
```

- [ ] **Step 3: typecheck + build** (ASCII-clean main bundle), lint. Commit - `feat(ipc): neon:* channels (main-only key + conn URI, scrubbed)`

---

### Task 4: Shared types + preload

**Files:**
- Modify: `packages/app/src/shared/ipc.ts` (re-export Neon types like DbTable; AirlockApi ~135)
- Modify: `packages/app/src/preload/index.ts` (after db* ~53)

- [ ] **Step 1: shared/ipc.ts** - re-export the Neon types from agent-core (mirror how `DbTable`/`QueryResult` are imported+re-exported) and extend `AirlockApi`:
```ts
  neonStatus(): Promise<{ connected: boolean }>;
  neonConnect(key: string): Promise<{ connected: boolean }>;
  neonProjects(): Promise<NeonProject[]>;
  neonBranches(projectId: string): Promise<NeonBranch[]>;
  neonDatabases(projectId: string, branchId: string): Promise<NeonDatabase[]>;
  neonPing(projectId: string, branchId: string, database: string, role: string): Promise<{ ok: boolean; error?: string }>;
  neonTables(projectId: string, branchId: string, database: string, role: string): Promise<DbTable[]>;
  neonRows(projectId: string, branchId: string, database: string, role: string, schema: string, table: string, limit: number): Promise<QueryResult>;
```

- [ ] **Step 2: preload/index.ts** - mirror the db* invokes:
```ts
  neonStatus: () => ipcRenderer.invoke("neon:status"),
  neonConnect: (key) => ipcRenderer.invoke("neon:connect", key),
  neonProjects: () => ipcRenderer.invoke("neon:projects"),
  neonBranches: (p) => ipcRenderer.invoke("neon:branches", p),
  neonDatabases: (p, b) => ipcRenderer.invoke("neon:databases", p, b),
  neonPing: (p, b, db, role) => ipcRenderer.invoke("neon:ping", p, b, db, role),
  neonTables: (p, b, db, role) => ipcRenderer.invoke("neon:tables", p, b, db, role),
  neonRows: (p, b, db, role, schema, table, limit) =>
    ipcRenderer.invoke("neon:rows", p, b, db, role, schema, table, limit),
```

- [ ] **Step 3: typecheck + build + lint.** Commit - `feat(shared): neon* AirlockApi surface + preload`

---

### Task 5: Store dbView union + modal variant + DataGrid branch

**Files:**
- Modify: `packages/app/src/renderer/src/store.ts` (dbView ~43, setDbView ~201; modal ~45)
- Modify: `packages/app/src/renderer/src/components/DataGrid.tsx` (fetch ~39-45)
- Modify: `packages/app/src/renderer/src/components/DatabasesSection.tsx` (openTable ~70-72)

- [ ] **Step 1: store.ts** - replace the `dbView` shape with a discriminated union and add the modal variant:
```ts
export type DbView =
  | { kind: "secret"; id: string; schema: string; table: string }
  | {
      kind: "neon";
      projectId: string;
      branchId: string;
      database: string;
      role: string;
      schema: string;
      table: string;
    };
```
Change the state field to `dbView: DbView | null;` and `setDbView: (v: DbView | null) => void;`. `setDbView`'s body is UNCHANGED (it just stores `v` and nulls the other three viewer targets). Change `modal` type to `"add-secret" | { update: string } | "connect-neon" | null`.

- [ ] **Step 2: DatabasesSection.openTable** - tag the existing target:
```ts
  const openTable = (id: string, t: DbTable) => {
    useApp.getState().setDbView({ kind: "secret", id, schema: t.schema, table: t.name });
  };
```

- [ ] **Step 3: DataGrid.tsx** - branch the fetch on `dbView.kind` (keep everything else):
```ts
      const result =
        view.kind === "neon"
          ? await window.airlock.neonRows(view.projectId, view.branchId, view.database, view.role, view.schema, view.table, 100)
          : await window.airlock.dbRows(view.id, view.schema, view.table, 100);
```
(Use the local `view` the component already derives from `dbView`; the title/close logic is unchanged. If the header shows `id`, show `view.kind === "neon" ? view.database : view.id`.)

- [ ] **Step 4: typecheck + build + lint.** Commit - `feat(renderer): dbView union (secret|neon) + connect-neon modal variant`

---

### Task 6: NeonConnectModal + connect flow

**Files:**
- Create: `packages/app/src/renderer/src/components/NeonConnectModal.tsx`
- Modify: `packages/app/src/renderer/src/App.tsx` (modal mount ~48)
- Modify: `packages/app/src/renderer/src/theme.css` (reuse modal classes; no new layout needed)

- [ ] **Step 1: NeonConnectModal.tsx** - reuse the SecretModal CSS classes (`modal-backdrop`, `modal`, masked input, Save). Single masked field for the API key; on Save call `window.airlock.neonConnect(key)`, then `setModal(null)` on success, show an inline error on failure. Include the "This key never reaches the AI model" caption (consistent with SecretModal). Read `setModal` from the store. Structure (match SecretModal's markup/classes):
```tsx
export function NeonConnectModal() {
  const setModal = useApp((s) => s.setModal);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!key.trim()) return;
    setBusy(true);
    try {
      await window.airlock.neonConnect(key.trim());
      setModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  // ... modal-backdrop + modal: title "Connect Neon", masked textarea bound to
  // key, caption "This key is stored in your keychain and never reaches the AI
  // model.", error line, Cancel (setModal(null)) + Save (submit, disabled when
  // busy or empty). Mirror SecretModal markup/classNames exactly.
}
```

- [ ] **Step 2: App.tsx** - render it alongside SecretModal:
```tsx
{modal === "connect-neon" && <NeonConnectModal />}
```
Keep the existing SecretModal mount; ensure the `key=` expression on SecretModal still only handles its own shapes (it renders only when `modal === "add-secret" || typeof modal === "object"`).

- [ ] **Step 3: typecheck + build + lint.** Commit - `feat(renderer): Connect Neon modal (global key entry)`

---

### Task 7: NeonSection tree + Sidebar wiring

**Files:**
- Create: `packages/app/src/renderer/src/components/NeonSection.tsx`
- Modify: `packages/app/src/renderer/src/components/Sidebar.tsx` (Databases section ~ render NeonSection above DatabasesSection)
- Modify: `packages/app/src/renderer/src/theme.css` (tree indentation; reuse `.status-dot`, `.db-table-row`)

- [ ] **Step 1: NeonSection.tsx** - a lazy tree. Follow `DatabasesSection`'s lazy pattern (fetch-on-expand, cache in keyed records, parallel ping). Behavior:
  - On mount call `neonStatus()`. Re-check whenever `modal` transitions to `null` (so the tree appears right after Connect). Read `modal` from the store and key an effect on it.
  - **Not connected:** render a `Connect Neon` button -> `useApp.getState().setModal("connect-neon")`.
  - **Connected:** `neonProjects()` -> list projects (expandable). On project expand: `neonBranches(projectId)` (cache by projectId). On branch expand: `neonDatabases(projectId, branchId)` (cache by `${projectId}/${branchId}`). Each DATABASE row:
    - status dot via `neonPing(projectId, branchId, database, ownerName)` (kick off on first reveal; map to `status-dot on/fail/checking` like DatabasesSection lines 93-99).
    - expandable -> `neonTables(projectId, branchId, database, ownerName)` (cache by `${projectId}/${branchId}/${database}`), each table a `db-table-row` button calling:
```ts
useApp.getState().setDbView({
  kind: "neon", projectId, branchId, database, role: ownerName,
  schema: t.schema, table: t.name,
});
```
  - Errors per node: catch and show a small inline error (do not crash the tree). All async results applied with a stale-guard if the key/connection changes (mirror DatabasesSection's approach; at minimum guard against setState after unmount).
  - Keep the component focused; composite-key records (`Record<string, ...>`) for branches/databases/tables/pings/expanded mirror DatabasesSection's single-level maps one level deeper.

- [ ] **Step 2: Sidebar.tsx** - render `<NeonSection />` immediately above `<DatabasesSection />` INSIDE the Databases `<Section>`:
```tsx
{vis.databases && (
  <Section id="databases" title="Databases" defaultOpen={false}>
    <NeonSection />
    <DatabasesSection />
  </Section>
)}
```

- [ ] **Step 3: CSS** - add minimal tree indentation (e.g. `.neon-tree .neon-row { padding-left: ... }` per depth) reusing existing vars; reuse `.status-dot`, `.db-table-row`, `.section-body` styles. No new colors.

- [ ] **Step 4: typecheck + build + lint.** Commit - `feat(renderer): Neon projects/branches/databases tree in Databases`

---

### Task 8: Docs + verify + repackage + gate

**Files:**
- Modify: `docs/superpowers/specs/2026-06-04-neon-render-host-design.md` (status note), `docs/superpowers/specs/2026-06-03-airlock-v1-design.md` (dated note), `README.md`

- [ ] **Step 1:** Add a dated note to the v1 design spec (2026-06-04, Neon-in-Databases shipped: Slice A of the neon/render/host design) and flip the dedicated spec's Status to "Slice A complete; Slice B (Host) pending". Keep prior notes intact.
- [ ] **Step 2:** README - "Neon" subsection under Databases: Connect Neon with an API key (stored in your keychain, never seen by the agent), then browse projects -> branches -> databases with the same live dots / tables / data grid.
- [ ] **Step 3: Full verify (report each):** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run package` (electron-builder --dir; do NOT launch -- owner's app holds the single-instance lock). Confirm `.app` mtime advances.
- [ ] **Step 4: Commit (NO tag)** - `docs: neon-in-databases (slice A) complete; repackaged`
- [ ] **Step 5:** HUMAN GATE - owner relaunches, runs Connect Neon with a real key, and verifies the projects/branches/databases tree loads, dots go live, tables open in the data grid, and no key/connstring is exposed.

---

## Self-review notes
- Spec coverage: global creds (T1), Neon client (T2), main-only conn-uri + scrubbed IPC (T3), API surface (T4), data-grid reuse via dbView union (T5), connect flow (T6), the tree (T7). Covered.
- Security: API key + conn URIs resolved main-side only; `neon:*` never returns either; errors scrubbed via `redactConnStrings`; rethrows carry no `cause`; global key write audited. Mirrors the db:* discipline the audit already validated.
- Type consistency: `NeonProject/Branch/Database` defined once in agent-core, re-exported via shared (like DbTable/QueryResult). `neonConnectionUri`/`neonUri`/`neon:*` arg order (projectId, branchId, database, role[, schema, table, limit]) is identical at every call site.
- Reuse: `withDb`/`pingDb`/`listTables`/`readRows` unchanged; DataGrid reused via the union; SecretModal untouched (dedicated NeonConnectModal).
