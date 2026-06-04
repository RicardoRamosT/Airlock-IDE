# Sidebar Section Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user show/hide any sidebar section (Files, Secrets, Git, Databases, Docker, Audit) from a new View -> Sidebar menu and via right-click on a section header, with the choice persisted app-globally and re-applied on launch.

**Architecture:** Single source of truth in the MAIN process. Both the native View menu checkbox and the renderer's right-click "Hide" call one main funnel (`changeSectionVisibility`) that (1) persists the full visibility map to `prefs.json`, (2) rebuilds the application menu so checkmarks stay correct, and (3) pushes the authoritative map to the renderer over a `sections:changed` channel. The renderer is purely reactive for visibility changes -- it only ever applies what main pushes (plus a one-time startup hydrate from `prefs:get`), which eliminates menu/sidebar drift and the hydrate-vs-fast-toggle race. Visibility is app-global (one map in `AppPrefs`), distinct from a section's collapsed/expanded state (which stays local and unpersisted).

**Tech Stack:** Electron `Menu` (first custom app menu in the project -- replaces the default wholesale, so standard roles are re-declared), existing `prefs.json` store (`main/prefs.ts`), Zustand store + `usePrefs` hydrate, React/CodeMirror renderer, vitest, biome.

**Section list (canonical order + ids):** `files`, `secrets`, `git`, `databases`, `docker`, `audit`. Default = all visible.

**Key constraints (carry into every task):**
- `savePrefs` merge is SHALLOW (`main/prefs.ts`), so the renderer/menu never send a partial `sectionVisibility`; main always computes and writes the COMPLETE map. Callers send only `(id, visible)`.
- `sanitize` in `main/prefs.ts` is an ALLOWLIST -- a new pref field is silently stripped unless `sanitize` is taught about it. Add a `sectionVisibility` branch or it will not persist.
- ASCII-only comments in `packages/agent-core` (none of this plan touches agent-core, but `main/*` is also CJS-bundled into Electron main -- keep `main/menu.ts`, `main/prefs.ts`, `main/ipc.ts`, `main/index.ts` comments ASCII-only to avoid the cjs_lexer crash).
- The recurring hydrate race: the renderer applies runtime visibility ONLY from the `sections:changed` push, and the push handler sets `layoutHydrated=true` before applying so a late startup `prefsGet` cannot clobber it.

---

### Task 1: Shared types + prefs core

**Files:**
- Modify: `packages/app/src/shared/ipc.ts` (AppPrefs at ~61-70; AirlockApi at ~82-136)
- Modify: `packages/app/src/main/prefs.ts` (DEFAULTS ~13-17; sanitize ~19-30)
- Test: `packages/app/src/main/prefs.test.ts`

- [ ] **Step 1: Add the types to `shared/ipc.ts`**

```ts
export type Section =
  | "files"
  | "secrets"
  | "git"
  | "databases"
  | "docker"
  | "audit";
export type SectionVisibility = Record<Section, boolean>;

export interface AppPrefs {
  sidebarVisible: boolean;
  sidebarPosition: "left" | "right";
  theme: "dark" | "light";
  sectionVisibility: SectionVisibility; // app-global; default all true
}
```

- [ ] **Step 2: Write failing prefs tests**

Add to `prefs.test.ts`: (a) `loadPrefs` of a missing file returns defaults whose `sectionVisibility` is all-true; (b) `sanitize`/`savePrefs` of `{ sectionVisibility: { docker: false } }` yields a FULL map with `docker:false` and the other five `true`; (c) garbage (`sectionVisibility: 5`, or `{ docker: "no", bogus: 1 }`) falls back to defaults per-key and drops unknown keys. NOTE: existing tests assert the whole object via `toEqual` -- update those expected objects to include the new `sectionVisibility` field.

Run: `npm test -- prefs` -> Expected: FAIL (sectionVisibility undefined).

- [ ] **Step 3: Implement in `main/prefs.ts`**

```ts
import type { AppPrefs, Section, SectionVisibility } from "../shared/ipc";

export const SECTIONS: Section[] = [
  "files",
  "secrets",
  "git",
  "databases",
  "docker",
  "audit",
];

const DEFAULT_SECTION_VISIBILITY: SectionVisibility = {
  files: true,
  secrets: true,
  git: true,
  databases: true,
  docker: true,
  audit: true,
};

const DEFAULTS: AppPrefs = {
  sidebarVisible: true,
  sidebarPosition: "left",
  theme: "dark",
  sectionVisibility: { ...DEFAULT_SECTION_VISIBILITY },
};

// Allowlist per key: only a real boolean overrides the default; unknown keys
// (and a non-object) are dropped. Always returns a COMPLETE map.
function sanitizeSectionVisibility(raw: unknown): SectionVisibility {
  const out: SectionVisibility = { ...DEFAULT_SECTION_VISIBILITY };
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const key of SECTIONS) {
      if (typeof r[key] === "boolean") out[key] = r[key] as boolean;
    }
  }
  return out;
}
```

In `sanitize()`'s returned object add:
```ts
    sectionVisibility: sanitizeSectionVisibility(r.sectionVisibility),
```

- [ ] **Step 4: Run tests -> PASS.** Run: `npm test -- prefs`.
- [ ] **Step 5: Commit** -- `feat(prefs): app-global section visibility type + sanitize`

---

### Task 2: Custom application menu (first in the project)

**Files:**
- Create: `packages/app/src/main/menu.ts`
- Modify: `packages/app/src/main/index.ts` (import + build after `createWindow()` at ~90; needs `loadPrefs`)
- Test: `packages/app/src/main/menu.test.ts`

- [ ] **Step 1: Write failing test for the pure submenu builder** (`menu.test.ts`)

Assert `sectionSubmenuItems(vis, onToggle)` returns 6 items, each `type:"checkbox"`, labels `["Files","Secrets","Git","Databases","Docker","Audit"]` in order, `checked` mirrors `vis` (e.g. `vis.docker=false` -> that item `checked:false`), and invoking item `n`'s `click({checked:false})` calls `onToggle("<id>", false)`. (MenuItemConstructorOptions is a plain object; no Electron runtime needed.)

Run: `npm test -- menu` -> FAIL (module missing).

- [ ] **Step 2: Implement `main/menu.ts`**

```ts
import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import type { Section, SectionVisibility } from "../shared/ipc";
import { loadPrefs, savePrefs, SECTIONS } from "./prefs";

const SECTION_LABELS: Record<Section, string> = {
  files: "Files",
  secrets: "Secrets",
  git: "Git",
  databases: "Databases",
  docker: "Docker",
  audit: "Audit",
};

// Pure: the View -> Sidebar checkbox rows. Tested without Electron.
export function sectionSubmenuItems(
  visibility: SectionVisibility,
  onToggle: (id: Section, visible: boolean) => void,
): MenuItemConstructorOptions[] {
  return SECTIONS.map((id) => ({
    label: SECTION_LABELS[id],
    type: "checkbox",
    checked: visibility[id] !== false,
    click: (item) => onToggle(id, item.checked),
  }));
}

// Build + install the application menu. setApplicationMenu REPLACES the
// default wholesale, so the standard roles are re-declared to keep Reload /
// Zoom / Full Screen / copy-paste. View also carries the Sidebar submenu.
export function applyAppMenu(
  prefsFile: string,
  visibility: SectionVisibility,
): void {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        {
          label: "Sidebar",
          submenu: sectionSubmenuItems(visibility, (id, vis) => {
            void changeSectionVisibility(prefsFile, id, vis);
          }),
        },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// The SINGLE funnel for a visibility change, from the menu OR the renderer.
// Writes the complete map (savePrefs merge is shallow), rebuilds the menu so
// checkmarks track, and pushes the authoritative map to the renderer.
export async function changeSectionVisibility(
  prefsFile: string,
  id: Section,
  visible: boolean,
): Promise<SectionVisibility> {
  const cur = await loadPrefs(prefsFile);
  const next: SectionVisibility = { ...cur.sectionVisibility, [id]: visible };
  await savePrefs(prefsFile, { sectionVisibility: next });
  applyAppMenu(prefsFile, next);
  const wc = BrowserWindow.getAllWindows()[0]?.webContents;
  if (wc && !wc.isDestroyed()) wc.send("sections:changed", next);
  return next;
}
```

- [ ] **Step 3: Wire into `main/index.ts`** -- add `import { applyAppMenu } from "./menu";` and `import { loadPrefs } from "./prefs";`. In the `whenReady` block, AFTER `createWindow()`:
```ts
    const prefs = await loadPrefs(prefsFile);
    applyAppMenu(prefsFile, prefs.sectionVisibility);
```

- [ ] **Step 4: Run tests + typecheck + build -> PASS.** Run: `npm test -- menu && npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** -- `feat(main): custom app menu with View > Sidebar toggles + change funnel`

---

### Task 3: IPC + preload + API surface

**Files:**
- Modify: `packages/app/src/main/ipc.ts` (add handler near the prefs handlers ~116-122; import `changeSectionVisibility` from `./menu` and `SECTIONS` from `./prefs`)
- Modify: `packages/app/src/preload/index.ts` (invoke ~52-53; event listener ~21-22)
- Modify: `packages/app/src/shared/ipc.ts` (AirlockApi)

- [ ] **Step 1: Add the IPC handler in `ipc.ts`** (NOT requireRoot-gated -- app-global):
```ts
  ipcMain.handle("sections:set", (_e, id: unknown, visible: unknown) => {
    if (
      typeof id !== "string" ||
      !SECTIONS.includes(id as Section) ||
      typeof visible !== "boolean"
    ) {
      throw new Error("Invalid payload");
    }
    return changeSectionVisibility(prefsFile, id as Section, visible);
  });
```
Add imports: `import { changeSectionVisibility } from "./menu";`, `import { SECTIONS } from "./prefs";`, and `Section` to the existing `import type { AppPrefs } from "../shared/ipc";` line.

- [ ] **Step 2: Add to `AirlockApi` in `shared/ipc.ts`**:
```ts
  setSectionVisibility(id: Section, visible: boolean): Promise<SectionVisibility>;
  onSectionsChanged(cb: (v: SectionVisibility) => void): () => void;
```

- [ ] **Step 3: Expose in `preload/index.ts`** (mirror `prefsSet` / `onPtyData`):
```ts
  setSectionVisibility: (id, visible) =>
    ipcRenderer.invoke("sections:set", id, visible),
  onSectionsChanged: (cb) => subscribe<SectionVisibility>("sections:changed", cb),
```

- [ ] **Step 4: typecheck + build -> PASS.** Run: `npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** -- `feat(ipc): sections:set channel + sections:changed push`

---

### Task 4: Renderer store + hydration + push subscription

**Files:**
- Modify: `packages/app/src/renderer/src/store.ts` (interface ~36/70; defaults ~118; impl ~177)
- Modify: `packages/app/src/renderer/src/lib/usePrefs.ts`

- [ ] **Step 1: Store field + default + setter** (`store.ts`):
```ts
  // interface:
  sectionVisibility: SectionVisibility; // app-global (persisted)
  setSectionVisibility: (v: SectionVisibility) => void;
  // defaults block:
  sectionVisibility: {
    files: true,
    secrets: true,
    git: true,
    databases: true,
    docker: true,
    audit: true,
  },
  // impl:
  setSectionVisibility: (sectionVisibility) => set({ sectionVisibility }),
```
Import `SectionVisibility` from the shared types (match how the store imports other shared types).

- [ ] **Step 2: Hydrate + subscribe in `usePrefs.ts`** -- add `setSectionVisibility` to the selectors; inside the guarded `.then` (alongside the other three setters) add `setSectionVisibility(p.sectionVisibility);`; add `setSectionVisibility` to that effect's dep array. Then add a SEPARATE effect for the runtime push:
```ts
  // Runtime visibility changes (menu or right-click) arrive as an authoritative
  // push from main. Mark hydrated first so a late startup prefsGet cannot
  // clobber the user's live change (the recurring hydrate race).
  useEffect(() => {
    return window.airlock.onSectionsChanged((v) => {
      useApp.getState().setLayoutHydrated(true);
      useApp.getState().setSectionVisibility(v);
    });
  }, []);
```

- [ ] **Step 3: typecheck + build -> PASS.** Run: `npm run typecheck && npm run build`.
- [ ] **Step 4: Commit** -- `feat(renderer): hydrate + live-apply section visibility`

---

### Task 5: Sidebar gating + right-click Hide

**Files:**
- Modify: `packages/app/src/renderer/src/components/Sidebar.tsx` (Section ~11-34; render ~36-79)
- Modify: `packages/app/src/renderer/src/theme.css` (add `.context-menu`; reuse `.popover-backdrop`/`.menu-item`)

- [ ] **Step 1: Extend the `Section` component** with an `id` and a right-click Hide menu (header stays a `<button>`; the context menu is a sibling, so no nested-button problem):
```tsx
function Section({
  id,
  title,
  children,
  defaultOpen = true,
}: {
  id: Section;
  title: string;
  children?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);
  return (
    <div className="section">
      <button
        type="button"
        className="section-header"
        onClick={() => setOpen(!open)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <i className={`codicon codicon-chevron-${open ? "down" : "right"}`} />
        <span className="section-title">{title}</span>
      </button>
      {open && <div className="section-body">{children}</div>}
      {menu && (
        <>
          <button
            type="button"
            className="popover-backdrop"
            aria-label="Close menu"
            onClick={() => setMenu(null)}
          />
          <div
            className="context-menu"
            style={{ left: menu.x, top: menu.y }}
          >
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                void window.airlock.setSectionVisibility(id, false);
                setMenu(null);
              }}
            >
              <span>Hide {title}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Gate each section in `Sidebar()`** on `sectionVisibility`, and pass `id`. Read `const vis = useApp((s) => s.sectionVisibility);`. Render each as `{vis.files && (<Section id="files" title="Files">...</Section>)}`, etc. for all six. Add an empty-state hint after the sections when none are visible:
```tsx
        {!Object.values(vis).some(Boolean) && (
          <div className="sidebar-empty">
            All sections hidden. Re-enable them from View {"->"} Sidebar.
          </div>
        )}
```
(Renderer file -- unicode is fine here; the cjs_lexer ASCII rule is main/agent-core only. Use a literal arrow in JSX as shown to keep it simple.)

- [ ] **Step 3: CSS** in `theme.css` (reuses existing `.menu-item`, `.popover-backdrop`):
```css
.context-menu {
  position: fixed;
  z-index: 20;
  min-width: 150px;
  padding: 4px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
.sidebar-empty {
  padding: 8px 12px;
  color: var(--fg-dim);
  font-size: 12px;
}
```

- [ ] **Step 4: typecheck + lint + build -> PASS.** Run: `npm run typecheck && npm run lint && npm run build`.
- [ ] **Step 5: Commit** -- `feat(renderer): hide/show sidebar sections (gating + right-click)`

---

### Task 6: Docs + verify + repackage + gate

**Files:**
- Modify: `docs/superpowers/specs/2026-06-03-airlock-v1-design.md` (insert-only dated note)
- Modify: `README.md`

- [ ] **Step 1: Spec note** -- add a dated blockquote (2026-06-04, section visibility): the sidebar now shows all sections by default; any can be hidden via right-click -> Hide or the new View -> Sidebar menu, and re-shown from that menu; visibility is app-global in `prefs.json`; the menu is the project's first custom Electron application menu (standard roles preserved); main is the single source of truth (menu + right-click funnel through `changeSectionVisibility`, which persists, rebuilds the menu, and pushes `sections:changed`). Keep all prior notes intact.
- [ ] **Step 2: README** -- short "Customizing the sidebar" section (hide via right-click or View -> Sidebar; re-show from the menu; remembered across launches).
- [ ] **Step 3: Full verify (report each):** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, then `npm run package` (electron-builder --dir; do NOT launch -- the owner's app holds the single-instance lock). Confirm the `.app` mtime advances.
- [ ] **Step 4: Commit (NO tag, do not push)** -- `docs: sidebar section visibility complete; repackaged`
- [ ] **Step 5:** HUMAN GATE -- the owner relaunches and verifies: right-click a header -> Hide makes it vanish; the View -> Sidebar menu shows it unchecked; re-checking brings it back; the choice survives a relaunch; standard View items (Reload/Zoom/Full Screen) still work.

---

## Self-review notes
- Spec coverage: show-all-default (T5), hide via menu (T2) + right-click (T5), re-show via menu (T2), persistence (T1+T4), View menu with standard items kept (T2). Covered.
- Type consistency: `Section`/`SectionVisibility` defined once in `shared/ipc.ts` (T1), consumed by prefs (T1), menu (T2), ipc (T3), store/usePrefs (T4), Sidebar (T5). `changeSectionVisibility` signature is identical at its menu call site (T2) and ipc call site (T3).
- Race guard: runtime apply only via `sections:changed` push, which sets `layoutHydrated=true` before applying (T4). Startup hydrate rides the existing single guard.
- Shallow-merge footgun: main always writes the complete map; callers pass only `(id, visible)` (T2/T3).
