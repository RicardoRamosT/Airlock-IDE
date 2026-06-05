# Host Section (Slice B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A new toggleable "Host" sidebar section with two groups: LOCAL (the project's dev server - live up/down dot via a TCP port probe, open-in-browser, URL from `.airlock/config.json` or guessed from `package.json`) and RENDER (a vaulted app-global Render API key -> the project's services, each with a live status dot, latest deploy state, and a "latest commit deployed?" check).

**Architecture:** Reuses Slice A's foundations: the app-global credential vault (`getGlobalSecret`/`setGlobalSecret`, `@global/<name>`, audited), the DI-transport HTTP client pattern (mirror `neon/client.ts` for Render), the connect-modal flow (mirror `NeonConnectModal` -> `RenderConnectModal`, modal variant `"connect-render"`), and the section-visibility machinery (add a 7th section `"host"`). New agent-core pieces: a Render REST client, a `probePort` (node:net), and two git helpers (`originRemoteUrl`, `headSha`). The Render API key and all deploy/commit comparison are resolved MAIN-ONLY; the renderer gets enriched per-service status only.

**Tech Stack:** global `fetch` (Render API), `node:net` (port probe), `git` via existing `runGit`, Electron `shell.openExternal`, the existing per-project `.airlock/config.json`, React/Zustand, vitest, biome.

**Carry into every task:**
- ASCII-only comments in ALL `agent-core/*` and `app/src/main/*` (CJS-bundled into Electron main; multibyte crashes the cjs_lexer).
- The Render API key is the app-global secret `RENDER_API_KEY`; it is MAIN-ONLY, never returned over IPC, never an agent tool (same hard rule as the Neon key).
- Render API errors that could carry the key are not expected (the Render client error is `Render API <status>`), but `render:*` handlers still wrap errors as a fresh `Error` with no `cause` and never echo the key.
- `render:*` and `host:openExternal`/`host:probe` are app-global / account-level -> NOT requireRoot-gated. `host:localUrl` and `config:*` ARE per-project (requireRoot).
- Two highest-risk gotchas (from the integration map): (1) `config:set` in ipc.ts allowlists fields explicitly - `devUrl` is dropped unless added there; (2) `prefs.ts` `SECTIONS` is a runtime array separate from the `Section` type - add `"host"` to BOTH or it's silently dropped at runtime.
- Export-name collisions: mirror Slice A's alias precedent - export the Render client functions render-prefixed (`renderListServices`, `renderLatestDeploy`) to avoid any clash.

---

### Task 1: agent-core Render API client

**Files:** Create `packages/agent-core/src/render/client.ts`, `render/parse.ts`, `render/parse.test.ts`; modify `packages/agent-core/src/index.ts`.

- [ ] **Step 1: Failing parser tests** (render/parse.test.ts). Render's list endpoints return an envelope `[{ service: {...} }]` / `[{ deploy: {...} }]`. Cover:
  - `parseServices([{service:{id:"srv-1",name:"web",repo:"https://github.com/o/r",branch:"main",serviceDetails:{url:"https://web.onrender.com"}}}])` -> `[{id:"srv-1",name:"web",repo:"https://github.com/o/r",branch:"main",url:"https://web.onrender.com"}]`. Also tolerate a bare `[{id,...}]` (no envelope) and missing serviceDetails -> `url:""`.
  - `parseLatestDeploy([{deploy:{status:"live",commit:{id:"abc123"}}}])` -> `{status:"live",commit:"abc123"}`; empty array -> `null`; missing commit -> `commit:""`.
  - `normalizeRepoUrl`: `https://github.com/Owner/Repo.git`, `git@github.com:Owner/Repo.git`, `https://github.com/Owner/Repo` all -> `"github.com/owner/repo"` (lowercased, no scheme, no `.git`, `:` in ssh form normalized to `/`). Empty/garbage -> `""`.
  Run `npm test -- render` -> RED.

- [ ] **Step 2: parse.ts** (ASCII comments):
```ts
import type { RenderDeploy, RenderService } from "./client";

function items(json: unknown): Record<string, unknown>[] {
  return Array.isArray(json) ? (json as Record<string, unknown>[]) : [];
}
const str = (o: Record<string, unknown> | undefined, k: string): string =>
  o && typeof o[k] === "string" ? (o[k] as string) : "";
// Each list item may be wrapped: {service:{...}} / {deploy:{...}}; unwrap if present.
function unwrap(item: Record<string, unknown>, key: string): Record<string, unknown> {
  const inner = item[key];
  return inner && typeof inner === "object" ? (inner as Record<string, unknown>) : item;
}

export function parseServices(json: unknown): RenderService[] {
  return items(json).map((it) => {
    const s = unwrap(it, "service");
    const details = (s.serviceDetails && typeof s.serviceDetails === "object"
      ? (s.serviceDetails as Record<string, unknown>) : undefined);
    return { id: str(s, "id"), name: str(s, "name"), repo: str(s, "repo"),
      branch: str(s, "branch"), url: str(details, "url") };
  });
}
export function parseLatestDeploy(json: unknown): RenderDeploy | null {
  const first = items(json)[0];
  if (!first) return null;
  const d = unwrap(first, "deploy");
  const commit = d.commit && typeof d.commit === "object"
    ? str(d.commit as Record<string, unknown>, "id") : "";
  return { status: str(d, "status"), commit };
}
export function normalizeRepoUrl(url: string): string {
  if (!url) return "";
  let s = url.trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^git@/, "");
  s = s.replace(/:/g, "/").replace(/\.git$/, "").replace(/\/+$/, "");
  return s;
}
```

- [ ] **Step 3: client.ts** (ASCII comments; mirror neon/client.ts):
```ts
import { parseLatestDeploy, parseServices } from "./parse";

const RENDER_API_BASE = "https://api.render.com/v1";

export interface RenderService { id: string; name: string; repo: string; branch: string; url: string; }
export interface RenderDeploy { status: string; commit: string; }

export interface RenderTransport { get(path: string, key: string): Promise<unknown>; }
export interface RenderOptions { transport?: RenderTransport; }

export const renderFetchTransport: RenderTransport = {
  async get(path, key) {
    const res = await fetch(`${RENDER_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Render API ${res.status} ${res.statusText}`);
    return res.json();
  },
};
const enc = encodeURIComponent;

export async function listServices(key: string, opts: RenderOptions = {}): Promise<RenderService[]> {
  const t = opts.transport ?? renderFetchTransport;
  return parseServices(await t.get("/services?limit=100", key));
}
export async function latestDeploy(key: string, serviceId: string, opts: RenderOptions = {}): Promise<RenderDeploy | null> {
  const t = opts.transport ?? renderFetchTransport;
  return parseLatestDeploy(await t.get(`/services/${enc(serviceId)}/deploys?limit=1`, key));
}
```

- [ ] **Step 4: index.ts** - export render-prefixed to avoid collisions: `listServices as renderListServices`, `latestDeploy as renderLatestDeploy`, `renderFetchTransport`, `normalizeRepoUrl`, and the types `RenderService`/`RenderDeploy`/`RenderTransport`/`RenderOptions`.
- [ ] **Step 5: GREEN** - `npm test`, typecheck, lint, build (agent-core CJS, ASCII). Commit - `feat(render): agent-core Render API client (DI transport, pure parsers)`

---

### Task 2: agent-core port probe + git helpers + config.devUrl

**Files:** Create `packages/agent-core/src/host/probe.ts`, `host/probe.test.ts`; modify `packages/agent-core/src/git/ops.ts`, `packages/agent-core/src/project/config.ts`, `packages/agent-core/src/index.ts`. (git tests: add to the existing git op test file if one exists.)

- [ ] **Step 1: probePort** (host/probe.ts, ASCII comments):
```ts
import { createConnection } from "node:net";

// Real adapter (untested-edge like fetchTransport). The PortProber type is the
// DI seam so consumers/tests can substitute it.
export type PortProber = (host: string, port: number, timeoutMs?: number) => Promise<boolean>;

export const probePort: PortProber = (host, port, timeoutMs = 500) =>
  new Promise((resolve) => {
    const sock = createConnection({ host, port });
    const done = (up: boolean) => { sock.destroy(); resolve(up); };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
```

- [ ] **Step 2: probe test** (host/probe.test.ts) - start a real ephemeral server, probe it (up=true), close it, probe (down=false):
```ts
import { createServer } from "node:net";
import { probePort } from "./probe";
// it("detects a listening port", async () => {
//   const srv = createServer();
//   const port: number = await new Promise((res) => srv.listen(0, "127.0.0.1", () => res((srv.address() as any).port)));
//   expect(await probePort("127.0.0.1", port)).toBe(true);
//   await new Promise((r) => srv.close(r));
//   expect(await probePort("127.0.0.1", port, 300)).toBe(false);
// });
```
Run `npm test -- probe` -> RED then GREEN.

- [ ] **Step 3: git helpers** (git/ops.ts) - mirror the existing `runGit` ops:
```ts
// Origin remote URL (null when no origin/remote -> caller falls back to all services).
export async function originRemoteUrl(root: string): Promise<string | null> {
  try {
    return (await runGit(root, ["remote", "get-url", "origin"])).trim() || null;
  } catch {
    return null;
  }
}
// Full SHA of a ref (default HEAD) for the deploy-vs-local compare.
export async function headSha(root: string, ref = "HEAD"): Promise<string> {
  return (await runGit(root, ["rev-parse", ref])).trim();
}
```
(If a git op test harness with a temp-repo exists, add tests: init repo, `remote add origin <url>`, assert `originRemoteUrl`; commit, assert `headSha` is 40 hex. If none exists, these are thin shell-out wrappers like the other ops - skip, note in the commit.)

- [ ] **Step 4: config.devUrl** (project/config.ts) - add `devUrl?: string;` to the `ProjectConfig` interface. `readProjectConfig` spreads parsed JSON (survives automatically); `writeProjectConfig` merges patch (a partial `{devUrl}` persists). Do NOT add devUrl to DEFAULTS (it's optional/undefined by default).

- [ ] **Step 5: index.ts** - export `probePort`, `PortProber`, `originRemoteUrl`, `headSha`. (`ProjectConfig` already exported.)
- [ ] **Step 6: GREEN** - test/typecheck/lint/build. Commit - `feat(agent-core): port probe + git origin/headSha + config.devUrl`

---

### Task 3: Host/Render IPC + preload + shared API

**Files:** Modify `packages/app/src/main/ipc.ts`, `packages/app/src/shared/ipc.ts`, `packages/app/src/preload/index.ts`.

- [ ] **Step 1: ipc.ts imports + key.** Add to the agent-core import: `getGlobalSecret`, `setGlobalSecret` (already imported), `renderListServices`, `renderLatestDeploy`, `normalizeRepoUrl`, `originRemoteUrl`, `headSha`, `probePort`, `readProjectConfig`, `readWorkspaceFile`. Add `shell` to the electron import: `import { dialog, ipcMain, shell } from "electron";`. Add `const RENDER_KEY = "RENDER_API_KEY";` near `NEON_KEY`.

- [ ] **Step 2: render:* handlers** (NOT requireRoot-gated; mirror neon:status/connect). `render:services` does the repo-filter + deploy + commit-compare main-side and returns enriched status (NO key, NO raw deploy object beyond what's needed):
```ts
  ipcMain.handle("render:status", async () => ({
    connected: (await getGlobalSecret(RENDER_KEY)) !== null,
  }));
  ipcMain.handle("render:connect", async (_e, key: unknown) => {
    if (typeof key !== "string" || !key.trim()) throw new Error("Invalid payload");
    await setGlobalSecret(RENDER_KEY, key.trim(), { auditLog: globalAuditLog });
    return { connected: true };
  });
  ipcMain.handle("render:services", async () => {
    const key = await getGlobalSecret(RENDER_KEY);
    if (!key) throw new Error("Render not connected");
    let services = await renderListServices(key);
    // Filter to THIS project's repo when a folder is open + has an origin.
    if (workspaceRoot) {
      const origin = await originRemoteUrl(workspaceRoot);
      if (origin) {
        const want = normalizeRepoUrl(origin);
        const matched = services.filter((s) => normalizeRepoUrl(s.repo) === want);
        if (matched.length > 0) services = matched;
      }
    }
    // Local HEAD sha for the deployed-or-not check (best-effort).
    let localSha = "";
    if (workspaceRoot) {
      try { localSha = await headSha(workspaceRoot); } catch { localSha = ""; }
    }
    const out = [];
    for (const s of services) {
      let deployStatus = "";
      let deployed: boolean | null = null;
      try {
        const dep = await renderLatestDeploy(key, s.id);
        if (dep) {
          deployStatus = dep.status;
          deployed = localSha && dep.commit ? dep.commit.startsWith(localSha) || localSha.startsWith(dep.commit) || dep.commit === localSha : null;
        }
      } catch {
        deployStatus = "";
      }
      out.push({ id: s.id, name: s.name, url: s.url, branch: s.branch, deployStatus, deployed });
    }
    return out; // RenderServiceStatus[] -- NO key, NO connstring
  });
```
(The deployed compare tolerates short-vs-full SHA via startsWith both ways. Define `RenderServiceStatus` in shared/ipc.ts.)

- [ ] **Step 3: host:* handlers.** `host:localUrl` (per-project: config.devUrl, else guess from package.json) and the account-level `host:probe`/`host:openExternal`:
```ts
  // Resolve the project's dev-server URL: config override, else guess from package.json.
  ipcMain.handle("host:localUrl", async () => {
    const root = requireRoot();
    const cfg = await readProjectConfig(root);
    if (cfg.devUrl) return cfg.devUrl;
    try {
      const { content } = await readWorkspaceFile(root, "package.json");
      const pkg = JSON.parse(content) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      const scriptText = Object.values(pkg.scripts ?? {}).join(" ");
      const portMatch = scriptText.match(/--port[ =](\d{2,5})/);
      const port = portMatch ? Number(portMatch[1])
        : deps.next ? 3000 : (deps.vite || deps["@vitejs/plugin-react"]) ? 5173
        : deps["react-scripts"] ? 3000 : deps.astro ? 4321 : null;
      return port ? `http://localhost:${port}` : null;
    } catch {
      return null;
    }
  });
  ipcMain.handle("host:probe", async (_e, url: unknown) => {
    if (typeof url !== "string") throw new Error("Invalid payload");
    let u: URL;
    try { u = new URL(url); } catch { return { up: false }; }
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    return { up: await probePort(u.hostname, port) };
  });
  ipcMain.handle("host:openExternal", (_e, url: unknown) => {
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) throw new Error("Invalid payload");
    return shell.openExternal(url);
  });
```

- [ ] **Step 4: config:set devUrl FIX** (the gotcha). Extend the existing `config:set` allowlist to pass through `devUrl`:
```ts
  ipcMain.handle("config:set", (_e, patch: unknown) => {
    if (!patch || typeof patch !== "object") throw new Error("Invalid payload");
    const p = patch as { injectSecretsIntoTerminal?: unknown; devUrl?: unknown };
    const clean: { injectSecretsIntoTerminal?: boolean; devUrl?: string } = {};
    if (typeof p.injectSecretsIntoTerminal === "boolean") clean.injectSecretsIntoTerminal = p.injectSecretsIntoTerminal;
    if (typeof p.devUrl === "string") clean.devUrl = p.devUrl;
    return writeProjectConfig(requireRoot(), clean);
  });
```

- [ ] **Step 5: shared/ipc.ts** - re-export `RenderService`/`RenderDeploy` types if needed by the renderer (the renderer mostly uses the enriched status), define `RenderServiceStatus`, and extend `AirlockApi`:
```ts
export interface RenderServiceStatus { id: string; name: string; url: string; branch: string; deployStatus: string; deployed: boolean | null; }
// AirlockApi:
  renderStatus(): Promise<{ connected: boolean }>;
  renderConnect(key: string): Promise<{ connected: boolean }>;
  renderServices(): Promise<RenderServiceStatus[]>;
  hostLocalUrl(): Promise<string | null>;
  hostProbe(url: string): Promise<{ up: boolean }>;
  hostOpenExternal(url: string): Promise<void>;
```
(Also add `devUrl?: string` reaches the renderer via the existing `ProjectConfig` re-export - confirm config type is re-exported; it is.)

- [ ] **Step 6: preload/index.ts** - add invokes:
```ts
  renderStatus: () => ipcRenderer.invoke("render:status"),
  renderConnect: (key) => ipcRenderer.invoke("render:connect", key),
  renderServices: () => ipcRenderer.invoke("render:services"),
  hostLocalUrl: () => ipcRenderer.invoke("host:localUrl"),
  hostProbe: (url) => ipcRenderer.invoke("host:probe", url),
  hostOpenExternal: (url) => ipcRenderer.invoke("host:openExternal", url),
```
- [ ] **Step 7: typecheck + build + lint** (ASCII main). Commit - `feat(ipc): render:* + host:* channels (main-only key, repo-filtered services)`

---

### Task 4: RenderConnectModal + connect-render variant

**Files:** Create `packages/app/src/renderer/src/components/RenderConnectModal.tsx`; modify `packages/app/src/renderer/src/store.ts` (modal type), `packages/app/src/renderer/src/App.tsx` (mount).

- [ ] **Step 1: store.ts** - add the variant: `modal: "add-secret" | { update: string } | "connect-neon" | "connect-render" | null;`
- [ ] **Step 2: RenderConnectModal.tsx** - copy NeonConnectModal.tsx; change the `neonConnect` call to `window.airlock.renderConnect(key.trim())`, the title to "Connect Render", the helper line to "Paste a Render API key (Render Dashboard -> Account Settings -> API Keys)", keep the masked field + "Stored in your macOS Keychain. This key never reaches the AI model." caption + error/busy handling identically.
- [ ] **Step 3: App.tsx** - import RenderConnectModal; add `{modal === "connect-render" && <RenderConnectModal />}` next to the connect-neon mount. The SecretModal guard already excludes string variants - confirm it stays correct (it renders for "add-secret" | object only).
- [ ] **Step 4: typecheck + build + lint.** Commit - `feat(renderer): Connect Render modal (global key entry)`

---

### Task 5: LocalHostSection + RenderSection components

**Files:** Create `packages/app/src/renderer/src/components/LocalHostSection.tsx`, `RenderSection.tsx`; modify `theme.css` (reuse docker/db classes; minimal additions).

- [ ] **Step 1: LocalHostSection.tsx** - mirror DockerSection's structure (refresh-on-focus + manual + busy). On mount + focus: `hostLocalUrl()` -> if a URL, `hostProbe(url)` -> dot up/down. Render: the URL text, a status dot (`status-dot on` when up, else `status-dot`), an "open in browser" button (`hostOpenExternal(url)`, codicon `link-external`), and a small "set URL" affordance (an input or edit button that calls `configSet({ devUrl })` then re-resolves). If `hostLocalUrl()` returns null, show "No dev server configured" + a set-URL input. Guard async setState against unmount (mounted ref). Refresh-on-focus listener added/removed in useEffect.
- [ ] **Step 2: RenderSection.tsx** - mirror NeonSection's connected/not-connected/checking three-way + DockerSection's row+dot. `renderStatus()` on mount; re-check when store `modal === null` (so it appears after Connect Render). Not connected -> "Connect Render" button -> `setModal("connect-render")`. Connected -> `renderServices()` -> each service row: status dot (map `deployStatus`: "live" -> `status-dot on`, "build_in_progress"/"update_in_progress"/"created" -> `status-dot` (checking-ish), "*failed"/"canceled"/"deactivated" -> `status-dot fail`), the service name, the deploy status text, a "deployed" badge (`deployed === true` -> "deployed" check; `false` -> "HEAD differs"; `null` -> nothing), and an open-in-browser button for `service.url`. Manual refresh button + busy guard. Errors -> inline message, never crash.
- [ ] **Step 3: theme.css** - reuse `.docker-row`/`.status-dot`/`.db-*`; add minimal `.host-*` only if needed (e.g. a deployed badge color reusing `--fg-dim`/`--accent`). No new palette.
- [ ] **Step 4: typecheck + build + lint** (a11y: all clickable rows/buttons are `<button type="button">`). Commit - `feat(renderer): LocalHostSection + RenderSection`

---

### Task 6: Wire the "host" section (7th section) + Sidebar

**Files:** Modify `packages/app/src/shared/ipc.ts` (Section type), `packages/app/src/main/prefs.ts` (SECTIONS + DEFAULT map), `packages/app/src/renderer/src/store.ts` (default vis), `packages/app/src/main/menu.ts` (labels), `packages/app/src/renderer/src/components/Sidebar.tsx` (the gated block), and the tests `packages/app/src/main/prefs.test.ts` + `menu.test.ts`.

- [ ] **Step 1: Section type** (shared/ipc.ts) - add `| "host"` to the `Section` union. (This forces the three `Record<Section,...>` maps to include host or fail typecheck.)
- [ ] **Step 2: prefs.ts** - add `"host"` to the `SECTIONS` array AND `host: true` to `DEFAULT_SECTION_VISIBILITY` (the runtime gotcha - both).
- [ ] **Step 3: store.ts** - add `host: true` to the default `sectionVisibility` map.
- [ ] **Step 4: menu.ts** - add `host: "Host"` to `SECTION_LABELS` (the View -> Sidebar checkbox appears automatically via `sectionSubmenuItems`).
- [ ] **Step 5: Sidebar.tsx** - import LocalHostSection + RenderSection; add the gated block (place between docker and audit):
```tsx
{vis.host && (
  <Section id="host" title="Host" defaultOpen={false}>
    <LocalHostSection />
    <RenderSection />
  </Section>
)}
```
- [ ] **Step 6: tests** - update `prefs.test.ts` (the `toEqual` full-visibility maps now include `host: true`; SECTIONS assertions) and `menu.test.ts` (label count / list now 7). Run them -> GREEN.
- [ ] **Step 7: typecheck + test + lint + build.** Commit - `feat(renderer): Host sidebar section (Local + Render), toggleable`

---

### Task 7: Docs + verify + repackage + gate

**Files:** Modify `docs/superpowers/specs/2026-06-04-neon-render-host-design.md` (status), `docs/superpowers/specs/2026-06-03-airlock-v1-design.md` (dated note), `README.md`.

- [ ] **Step 1:** Flip the dedicated spec Status to "Slice A + Slice B complete." Add a dated note to the v1 design spec (2026-06-04, Host section = Slice B: a 7th toggleable section; LOCAL dev-server up/down via TCP probe + open-in-browser, URL from config/package.json; RENDER services via a vaulted global RENDER_API_KEY filtered to the project's git remote, deploy status + latest-commit-deployed check; same main-only credential discipline). Keep prior notes intact.
- [ ] **Step 2:** README - "Host" subsection (Local dev server status + open-in-browser; Connect Render to see your services' deploy status and whether your latest commit is live). Update the feature/status line.
- [ ] **Step 3: Full verify (report each):** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run package` (electron-builder --dir; do NOT launch - owner's app holds the lock). Confirm `.app` mtime advances.
- [ ] **Step 4: Commit (NO tag)** - `docs: host section (slice B) complete; repackaged`
- [ ] **Step 5:** HUMAN GATE - owner relaunches: the Host section appears (toggleable via right-click/View->Sidebar); LOCAL shows the dev-server URL with an up/down dot (start your dev server -> dot goes green) + open-in-browser; Connect Render with a real key -> the project's service(s) show with deploy status + "latest commit deployed?".

---

## Self-review notes
- Spec coverage: Render client (T1); probe + git + config (T2); render/host IPC incl. repo-filter + deploy-compare + the config:set fix (T3); connect flow (T4); both UI groups (T5); the 7th section wiring across all 6 enumeration spots (T6). Covered.
- Security: RENDER_API_KEY is main-only (getGlobalSecret), never returned (render:status->bool, render:connect->{connected}, render:services->enriched status w/ no key); audited on connect; no requireRoot for account-level channels; host:openExternal validates http(s) only.
- Gotchas closed: config:set devUrl allowlist (T3 Step 4); SECTIONS runtime array + type both updated (T6 Steps 1-2); render export aliases (T1 Step 4).
- Reuse: getGlobalSecret/setGlobalSecret, the DI-transport pattern, NeonConnectModal->RenderConnectModal, the section machinery, DockerSection/NeonSection UI patterns. New: render client, probePort, originRemoteUrl/headSha.
