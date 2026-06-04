# Airlock Layout Controls Plan (top-right cluster, app-global)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A VS Code-style layout cluster in the top-right of the title bar with three controls — **toggle sidebar** (show/hide), **flip sidebar side** (left ⇄ right), **maximize terminal** (relocated here from the terminal tab strip). Sidebar visibility + position persist **app-globally** across restarts; maximize stays session-only (it's a transient focus action, not a saved layout).

**Owner decisions (2026-06-04):** cluster = toggle + flip + maximize (maximize moves here); persistence = app-global. airlock has ONE toggleable chrome region (the sidebar) and no bottom panel, so the cluster is 3 buttons, not VS Code's 4 — no fake controls.

**Context:** branched off `feat/hardening` (HEAD 7735c11, still awaiting the owner's gate). This introduces airlock's first app-global preference store (userData JSON) — distinct from per-project `.airlock/config.json` and the keychain. It must NOT live in agent-core (uses Electron's userData path); the pure read/write logic is electron-free and testable.

---

### Task 1: App-global prefs store (TDD) + IPC

**Files:**
- Create: `packages/app/src/main/prefs.ts`
- Create: `packages/app/src/main/prefs.test.ts`
- Modify: `packages/app/src/shared/ipc.ts`
- Modify: `packages/app/src/main/ipc.ts`
- Modify: `packages/app/src/preload/index.ts`
- Modify: `packages/app/src/main/index.ts`

- [ ] **Step 1: prefs.ts** — pure read/write keyed by an explicit file path (electron-free; node:fs only; ASCII comments since it could in principle be bundled — keep ASCII regardless):

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface AppPrefs {
  sidebarVisible: boolean;
  sidebarPosition: "left" | "right";
}

const DEFAULTS: AppPrefs = { sidebarVisible: true, sidebarPosition: "left" };

function sanitize(raw: unknown): AppPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };
  const r = raw as Record<string, unknown>;
  return {
    sidebarVisible: typeof r.sidebarVisible === "boolean" ? r.sidebarVisible : DEFAULTS.sidebarVisible,
    sidebarPosition: r.sidebarPosition === "right" ? "right" : "left",
  };
}

export async function loadPrefs(file: string): Promise<AppPrefs> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return { ...DEFAULTS }; // absent -> defaults (normal first run)
  }
  try {
    return sanitize(JSON.parse(text));
  } catch {
    // Malformed prefs must never break startup; warn and use defaults.
    console.warn("[airlock] prefs.json malformed, using defaults");
    return { ...DEFAULTS };
  }
}

export async function savePrefs(file: string, patch: Partial<AppPrefs>): Promise<AppPrefs> {
  const next = sanitize({ ...(await loadPrefs(file)), ...patch });
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, file);
  return next;
}
```

- [ ] **Step 2: prefs.test.ts** (TDD — witness fail first):

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadPrefs, savePrefs } from "./prefs";

describe("app prefs", () => {
  it("returns defaults when the file is absent", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    expect(await loadPrefs(path.join(dir, "prefs.json"))).toEqual({
      sidebarVisible: true,
      sidebarPosition: "left",
    });
  });

  it("persists and reloads a patch", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    const file = path.join(dir, "prefs.json");
    const next = await savePrefs(file, { sidebarPosition: "right" });
    expect(next.sidebarPosition).toBe("right");
    expect(next.sidebarVisible).toBe(true);
    expect(await loadPrefs(file)).toEqual({ sidebarVisible: true, sidebarPosition: "right" });
  });

  it("sanitizes unknown/garbage fields", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    const file = path.join(dir, "prefs.json");
    await writeFile(file, JSON.stringify({ sidebarPosition: "sideways", sidebarVisible: "yes", junk: 1 }));
    expect(await loadPrefs(file)).toEqual({ sidebarVisible: true, sidebarPosition: "left" });
  });

  it("returns defaults (no throw) on malformed JSON", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    const file = path.join(dir, "prefs.json");
    await writeFile(file, "{ not json");
    expect(await loadPrefs(file)).toEqual({ sidebarVisible: true, sidebarPosition: "left" });
  });
});
```

- [ ] **Step 3: shared/ipc.ts** — re-export `AppPrefs` type (import from "../main/prefs"? NO — shared/ipc must not import main. Define the type in prefs.ts and re-declare/import carefully: simplest — `import type { AppPrefs } from "../main/prefs"` is a renderer-reachable import of a main file's TYPE only; types are erased so it's safe at runtime, but to keep layering clean, DEFINE `AppPrefs` in shared/ipc.ts and have prefs.ts import it from shared). DECISION: define `AppPrefs` in `shared/ipc.ts`, and `prefs.ts` imports it from `../shared/ipc`. Add to AirlockApi:

```ts
  prefsGet(): Promise<AppPrefs>;
  prefsSet(patch: Partial<AppPrefs>): Promise<AppPrefs>;
```

(Move the `AppPrefs` interface definition into shared/ipc.ts; prefs.ts does `import type { AppPrefs } from "../shared/ipc"`.)

- [ ] **Step 4: main/ipc.ts** — `registerIpc` already takes `getBaseEnv`; add a second param `prefsFile: string` (or a getter). Register:

```ts
  ipcMain.handle("prefs:get", () => loadPrefs(prefsFile));
  ipcMain.handle("prefs:set", (_e, patch: unknown) => {
    if (!patch || typeof patch !== "object") throw new Error("Invalid payload");
    return savePrefs(prefsFile, patch as Partial<AppPrefs>);
  });
```

(import loadPrefs/savePrefs from "./prefs"; AppPrefs type from "../shared/ipc"). NOTE prefs are app-global, NOT requireRoot-gated — they work with no folder open.

- [ ] **Step 5: preload/index.ts** — `prefsGet: () => ipcRenderer.invoke("prefs:get")`, `prefsSet: (patch) => ipcRenderer.invoke("prefs:set", patch)`.

- [ ] **Step 6: main/index.ts** — compute `const prefsFile = path.join(app.getPath("userData"), "prefs.json")` and pass into `registerIpc(() => loginEnv, prefsFile)`. (Preserve ALL existing wiring: single-instance lock, login-env capture, nav guards, etc.)

- [ ] **Step 7: verify** — `npm test` (current total + 4 prefs), typecheck, lint, `npm run build`. Commit: stage your files, message `feat(app): app-global prefs store (userData JSON) + IPC`

---

### Task 2: Layout cluster UI + sidebar position/visibility

**Files:**
- Modify: `packages/app/src/renderer/src/store.ts`
- Create: `packages/app/src/renderer/src/components/LayoutControls.tsx`
- Modify: `packages/app/src/renderer/src/components/TitleBar.tsx`
- Modify: `packages/app/src/renderer/src/components/TerminalTabs.tsx` (remove maximize button — it moves to LayoutControls)
- Modify: `packages/app/src/renderer/src/App.tsx`
- Modify: `packages/app/src/renderer/src/theme.css`

- [ ] **Step 1: store.ts** — add layout state (maximized already exists):

```ts
  sidebarVisible: boolean;     // default true
  sidebarPosition: "left" | "right";  // default "left"
  setSidebarVisible: (v: boolean) => void;
  toggleSidebar: () => void;
  setSidebarPosition: (p: "left" | "right") => void;
  toggleSidebarPosition: () => void;
```

Implement straightforwardly (initial true/"left"; toggles flip). Do NOT reset these in setRoot (they are app-global, not per-project). `maximized`/`toggleMaximized` stay as-is.

- [ ] **Step 2: LayoutControls.tsx** — the three-button cluster (each button MUST be `-webkit-app-region: no-drag` via the CSS class so it's clickable inside the draggable titlebar):

```tsx
import { useApp } from "../store";

export function LayoutControls() {
  const sidebarVisible = useApp((s) => s.sidebarVisible);
  const sidebarPosition = useApp((s) => s.sidebarPosition);
  const maximized = useApp((s) => s.maximized);
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  const toggleSidebarPosition = useApp((s) => s.toggleSidebarPosition);
  const toggleMaximized = useApp((s) => s.toggleMaximized);

  // Persist the two app-global prefs on change; maximize is transient (not saved).
  const onToggleSidebar = () => {
    const next = !sidebarVisible;
    toggleSidebar();
    void window.airlock.prefsSet({ sidebarVisible: next });
  };
  const onFlip = () => {
    const next = sidebarPosition === "left" ? "right" : "left";
    toggleSidebarPosition();
    void window.airlock.prefsSet({ sidebarPosition: next });
  };

  const sideIcon = sidebarPosition === "left" ? "left" : "right";
  return (
    <div className="layout-controls">
      <button
        type="button"
        className="layout-btn"
        title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
        onClick={onToggleSidebar}
      >
        <i className={`codicon codicon-layout-sidebar-${sideIcon}${sidebarVisible ? "" : "-off"}`} />
      </button>
      <button
        type="button"
        className="layout-btn"
        title={`Move sidebar ${sidebarPosition === "left" ? "right" : "left"}`}
        onClick={onFlip}
      >
        <i className="codicon codicon-arrow-swap" />
      </button>
      <button
        type="button"
        className="layout-btn"
        title={maximized ? "Restore layout" : "Maximize terminal"}
        onClick={toggleMaximized}
      >
        <i className={`codicon codicon-screen-${maximized ? "normal" : "full"}`} />
      </button>
    </div>
  );
}
```

CODICON VERIFY (sanctioned substitution if missing — grep `node_modules/@vscode/codicons/dist/codicon.css`): `layout-sidebar-left`, `layout-sidebar-right`, `layout-sidebar-left-off`, `layout-sidebar-right-off`, `arrow-swap`, `screen-full`, `screen-normal`. If `arrow-swap` is absent, use the nearest clear "swap/both-direction" glyph (`arrow-both`, `split-horizontal`) and report.

- [ ] **Step 3: TitleBar.tsx** — render LayoutControls right-aligned; keep the drag strip + title. The controls group is `no-drag`. Final:

```tsx
import { useApp } from "../store";
import { LayoutControls } from "./LayoutControls";

export function TitleBar() {
  const root = useApp((s) => s.root);
  const project = root ? (root.split("/").pop() ?? "") : "";
  return (
    <header className="titlebar">
      <span className="titlebar-title">{project ? `airlock - ${project}` : "airlock"}</span>
      <LayoutControls />
    </header>
  );
}
```

- [ ] **Step 4: TerminalTabs.tsx** — REMOVE the maximize button + its handler from the terminal strip (it now lives in LayoutControls). Keep split/new/close. `toggleMaximized`/`maximized` store usage in TerminalTabs is removed; the store fields stay (LayoutControls uses them).

- [ ] **Step 5: App.tsx** — apply layout classes to `.layout` from store:

```tsx
  const sidebarVisible = useApp((s) => s.sidebarVisible);
  const sidebarPosition = useApp((s) => s.sidebarPosition);
  ...
  <div className={`layout${sidebarPosition === "right" ? " sidebar-right" : ""}${sidebarVisible ? "" : " sidebar-hidden"}`}>
```

(Keep Sidebar + main children in DOM order; CSS handles visual placement. Keep the `app-shell maximized` class as-is.)

- [ ] **Step 6: theme.css** —
  - `.titlebar` becomes a flex row: title left (with left padding to clear the macOS traffic lights ~72px), controls pushed right. Replace the `display:grid; place-items:center` with `display:flex; align-items:center; padding-left:78px; padding-right:8px;` and `.titlebar-title { margin: 0 auto 0 0; }` (or center it — keep it simple, left-of-center after the inset). The whole `.titlebar` keeps `-webkit-app-region: drag`.
  - `.layout-controls { display:flex; gap:2px; -webkit-app-region: no-drag; }`
  - `.layout-btn { background:none; border:none; color:var(--fg-dim); cursor:pointer; padding:2px 6px; border-radius:4px; } .layout-btn:hover { background:var(--hover); color:var(--fg); } .layout-btn .codicon { font-size:15px; }`
  - Sidebar position/visibility on `.layout`:
    ```css
    .layout { display:grid; grid-template-columns: 230px minmax(0,1fr); min-height:0; }
    .layout.sidebar-right { grid-template-columns: minmax(0,1fr) 230px; }
    .layout.sidebar-right .sidebar { order: 2; border-right: none; border-left: 1px solid var(--border); }
    .layout.sidebar-hidden { grid-template-columns: minmax(0,1fr); }
    .layout.sidebar-hidden .sidebar { display: none; }
    ```
    (The `.main` is the other grid child; with `sidebar-right` the sidebar gets `order:2` so it renders visually right while staying second column. Verify the grid placement: with 2 columns and Sidebar as DOM-child-1, default it's col 1; for right, set Sidebar `order:2` AND ensure main takes col 1 — simplest is `.layout.sidebar-right .sidebar { order:2 }` and `.layout.sidebar-right .main { order:1 }`. Confirm visually-by-reasoning the sidebar lands in the right column.)
  - Maximize composition: the hardening-era `.app-shell.maximized .layout .sidebar { display:none }` and `.app-shell.maximized .main .viewer-pane { display:none }` still apply and must continue to win — verify specificity vs the new `.sidebar-right .sidebar` border rules (those set border/order, not display, so no conflict).

- [ ] **Step 7: verify** — typecheck, tests (no new — UI), lint, build. Reason in report: sidebar lands on the correct side for both positions; hidden hides it; maximize still hides sidebar+viewer and composes with position; buttons are no-drag/clickable. Commit: `feat(app): layout cluster - toggle/flip sidebar + maximize (moved from terminal strip)`

---

### Task 3: Persistence hydration + spec/README + verify + repackage

**Files:**
- Create: `packages/app/src/renderer/src/lib/usePrefs.ts`
- Modify: `packages/app/src/renderer/src/App.tsx`
- Modify: `docs/superpowers/specs/2026-06-03-airlock-v1-design.md`
- Modify: `README.md`

- [ ] **Step 1: usePrefs.ts** — hydrate the store from app-global prefs once on mount:

```ts
import { useEffect } from "react";
import { useApp } from "../store";

/** Load app-global layout prefs once at startup and hydrate the store. */
export function usePrefs(): void {
  const setSidebarVisible = useApp((s) => s.setSidebarVisible);
  const setSidebarPosition = useApp((s) => s.setSidebarPosition);
  useEffect(() => {
    let cancelled = false;
    window.airlock
      .prefsGet()
      .then((p) => {
        if (cancelled) return;
        setSidebarVisible(p.sidebarVisible);
        setSidebarPosition(p.sidebarPosition);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [setSidebarVisible, setSidebarPosition]);
}
```

- [ ] **Step 2: App.tsx** — call `usePrefs();` at the top (alongside `useGitStatus()`). Persistence on CHANGE is already handled in LayoutControls (prefsSet on toggle). This hook only handles load-on-startup.

- [ ] **Step 3: spec §9** — blockquote noting the layout cluster + app-global prefs (first non-project preference store; sidebar visibility/position persist; maximize transient).

- [ ] **Step 4: README** — one line under the UI/Terminal area: top-right layout cluster (toggle/flip sidebar, maximize), sidebar side+visibility remembered across launches.

- [ ] **Step 5: verify** — `npm test`, typecheck, lint, `npm run build`, `npm run package` (do NOT launch — owner's app holds the lock). Commit (NO tag): `feat(app): hydrate layout prefs on startup; docs; repackaged`

- [ ] **Step 6: HUMAN GATE** (owner; also covers the still-pending hardening fixes since this branches off them): top-right cluster present; toggle hides/shows sidebar; flip moves it to the other side; maximize swallows sidebar+viewer (and is gone from the terminal strip); quit + relaunch → sidebar side+visibility remembered. Verdict → tag, merge (hardening first, then this).

---

## Self-review
1. Owner decisions honored: 3 buttons (toggle/flip/maximize, maximize relocated), app-global persistence.
2. New app-global prefs store is electron-free in its logic (path injected), TDD'd, 0o600, corrupt-tolerant + sanitized — does NOT touch agent-core or the keychain; lives in main/.
3. AppPrefs type defined in shared/ipc.ts (single source); prefs.ts + main/ipc.ts import it; renderer reaches it via the re-export.
4. Maximize stays session-only/transient (not persisted) — deliberate; only sidebar visibility+position persist.
5. CSS: sidebar position via grid columns + order; visibility via display:none; composes with the hardening maximize rules (those set display via higher specificity; the new rules set border/order/columns, no display conflict). Buttons no-drag inside the drag titlebar.
6. agent-core untouched; ASCII rule N/A to renderer but prefs.ts kept ASCII anyway.
