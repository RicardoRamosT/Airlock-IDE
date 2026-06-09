# Activity Bar + Single Shared Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-pane stacked-accordion sidebar with a VS Code-style activity bar (icon rail, one view at a time) and a single sidebar shared across the project split, bound to the focused pane.

**Architecture:** A new `lib/sections.ts` is the single source of truth for section order/labels/icons and the `effectiveView` fallback rule. The store gains an app-global persisted `activeView`. `ActivityBar` (new) and a rewritten `Sidebar` render ONCE at App level; `ProjectPane` sheds its sidebar. Section components are untouched — they keep reading their pane via `useProjectTab()`, which falls back to the focused tab when no pane provider wraps them (exactly the sidebar's new position in the tree).

**Tech Stack:** React 18 + zustand store, vitest (+ @testing-library/react in jsdom for component tests), plain CSS in `theme.css`, codicons. Main-process prefs in `packages/app/src/main/prefs.ts` (pure node:fs, unit-tested).

**Spec:** `docs/superpowers/specs/2026-06-09-activity-bar-ui-design.md`

**Verification commands** (repo root): `npm test` (vitest), `npm run typecheck`, `npm run lint` (biome). Targeted test runs: `cd packages/app && npx vitest run <path-relative-to-packages/app>`.

**Commit convention:** commit after every task (user's global CLAUDE.md). Never push.

---

## File structure

| File | Role |
| --- | --- |
| `packages/app/src/renderer/src/lib/sections.ts` | **New.** `SECTION_META` (id/label/icon, canonical order) + pure `effectiveView()`. |
| `packages/app/src/renderer/src/store.ts` | + `activeView: Section`, `setActiveView`. |
| `packages/app/src/renderer/src/store.activeView.test.ts` | **New.** Store + `effectiveView` tests. |
| `packages/app/src/shared/ipc.ts` | `AppPrefs` + `activeView: Section`. |
| `packages/app/src/main/prefs.ts` | Default + sanitize `activeView`. |
| `packages/app/src/main/prefs.test.ts` | Defaults `toEqual` gains the field + sanitize test. |
| `packages/app/src/renderer/src/lib/usePrefs.ts` | Hydrate `activeView`. |
| `packages/app/src/renderer/src/components/ActivityBar.tsx` (+`.test.tsx`) | **New.** Icon rail + bottom Accounts/Settings buttons. |
| `packages/app/src/renderer/src/components/Sidebar.tsx` (+ **new** `Sidebar.test.tsx`) | Rewritten: header + single active view body + QuotaMeter. |
| `packages/app/src/renderer/src/components/ProjectPane.tsx` | Sidebar + `.layout` wrapper removed. |
| `packages/app/src/renderer/src/App.tsx` | `.workspace` row: ActivityBar / Sidebar / panes. |
| `packages/app/src/renderer/src/components/SidebarFooter.tsx` | **Deleted** (folded into ActivityBar). |
| `packages/app/src/renderer/src/lib/commands.ts` | Uses `SECTION_META`; + "Show <Section>" commands. |
| `packages/app/src/renderer/src/lib/commands.test.ts` | **New.** Show-command tests (jsdom). |
| `packages/app/src/renderer/src/App.smoke.test.tsx` | DEFAULT_PREFS + one-sidebar assertions. |
| `packages/app/src/renderer/src/theme.css` | `.workspace`, `.activity-bar*`, `.sidebar-view-*`; dead `.layout`/`.sidebar-footer`/accordion rules removed. |
| `CLAUDE.md` | Quota-meter gotcha line updated. |

---

### Task 1: Section metadata + store `activeView`

**Files:**
- Create: `packages/app/src/renderer/src/lib/sections.ts`
- Modify: `packages/app/src/renderer/src/store.ts`
- Create: `packages/app/src/renderer/src/store.activeView.test.ts`

- [ ] **Step 1.1: Write the failing test**

Create `packages/app/src/renderer/src/store.activeView.test.ts`:

```ts
import { afterEach, beforeEach, expect, it } from "vitest";
import type { SectionVisibility } from "../../shared/ipc";
import { SECTION_META, effectiveView } from "./lib/sections";
import { useApp } from "./store";

const initialState = useApp.getState();
beforeEach(() => useApp.setState(initialState, true));
afterEach(() => useApp.setState(initialState, true));

const allVisible = Object.fromEntries(
  SECTION_META.map((m) => [m.id, true]),
) as SectionVisibility;

it("lists all eight sections in canonical sidebar order", () => {
  expect(SECTION_META.map((m) => m.id)).toEqual([
    "files",
    "secrets",
    "git",
    "activity",
    "databases",
    "docker",
    "host",
    "audit",
  ]);
});

it("defaults the active view to files", () => {
  expect(useApp.getState().activeView).toBe("files");
});

it("setActiveView switches the view", () => {
  useApp.getState().setActiveView("git");
  expect(useApp.getState().activeView).toBe("git");
});

it("effectiveView returns the active view while it is visible", () => {
  expect(effectiveView("git", allVisible)).toBe("git");
});

it("falls back to the first visible section when the active one is hidden", () => {
  const vis = { ...allVisible, files: false, git: false };
  expect(effectiveView("git", vis)).toBe("secrets");
});

it("returns null when every section is hidden", () => {
  const vis = Object.fromEntries(
    SECTION_META.map((m) => [m.id, false]),
  ) as SectionVisibility;
  expect(effectiveView("files", vis)).toBeNull();
});
```

- [ ] **Step 1.2: Run it — expect failure**

Run: `cd packages/app && npx vitest run src/renderer/src/store.activeView.test.ts`
Expected: FAIL — `lib/sections` does not exist / `activeView` undefined.

- [ ] **Step 1.3: Implement**

Create `packages/app/src/renderer/src/lib/sections.ts`:

```ts
import type { Section, SectionVisibility } from "../../../shared/ipc";

// Single source of truth for the sidebar sections: canonical order, display
// label, and activity-bar icon (codicon name). The activity bar, the sidebar
// header, and the command palette all derive from this list.
export const SECTION_META: { id: Section; label: string; icon: string }[] = [
  { id: "files", label: "Files", icon: "files" },
  { id: "secrets", label: "Secrets", icon: "lock" },
  { id: "git", label: "Git", icon: "source-control" },
  { id: "activity", label: "Activity", icon: "pulse" },
  { id: "databases", label: "Databases", icon: "database" },
  { id: "docker", label: "Docker", icon: "vm" },
  { id: "host", label: "Host", icon: "globe" },
  { id: "audit", label: "Audit", icon: "shield" },
];

// The view the sidebar actually shows: the chosen view while visible, else the
// first visible section in rail order, else null (everything hidden). Pure
// read-time fallback -- hiding the active section via menu/MCP degrades
// gracefully without writing state.
export function effectiveView(
  active: Section,
  vis: SectionVisibility,
): Section | null {
  if (vis[active]) return active;
  return SECTION_META.find((m) => vis[m.id])?.id ?? null;
}
```

In `packages/app/src/renderer/src/store.ts`:

(a) The shared-ipc type import at the top of the file already imports `SectionVisibility`; add `Section` to that same `import type { ... } from "../../shared/ipc"` list.

(b) In `interface AppState`, directly under the line
`sectionVisibility: SectionVisibility; // app-global (persisted), gates sidebar sections`
add:

```ts
  activeView: Section; // app-global (persisted): which section the sidebar shows (activity bar)
```

(c) In the `--- App-global setters ---` block, under `setSectionVisibility: (v: SectionVisibility) => void;` add:

```ts
  setActiveView: (v: Section) => void;
```

(d) In the `create<AppState>` initial state, under the `sectionVisibility: { ... }` literal add:

```ts
  activeView: "files",
```

(e) Next to `setSectionVisibility: (sectionVisibility) => set({ sectionVisibility }),` add:

```ts
  setActiveView: (activeView) => set({ activeView }),
```

- [ ] **Step 1.4: Run the test — expect pass**

Run: `cd packages/app && npx vitest run src/renderer/src/store.activeView.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 1.5: Commit**

```bash
git add packages/app/src/renderer/src/lib/sections.ts packages/app/src/renderer/src/store.ts packages/app/src/renderer/src/store.activeView.test.ts
git commit -m "feat(ui): section metadata + app-global activeView store state"
```

---

### Task 2: Persist `activeView` in prefs

**Files:**
- Modify: `packages/app/src/shared/ipc.ts` (AppPrefs, ~line 284)
- Modify: `packages/app/src/main/prefs.ts` (DEFAULTS ~line 44, sanitize ~line 140)
- Modify: `packages/app/src/main/prefs.test.ts` (defaults `toEqual` ~line 11; new test)
- Modify: `packages/app/src/renderer/src/lib/usePrefs.ts`
- Modify: `packages/app/src/renderer/src/App.smoke.test.tsx` (DEFAULT_PREFS object)

- [ ] **Step 2.1: Write the failing test**

In `packages/app/src/main/prefs.test.ts`:

(a) In the `"returns defaults when the file is absent"` expectation object, directly under the `sectionVisibility: { ... }` literal, add:

```ts
      activeView: "files",
```

(b) Add a new test after the `"persists and reloads a patch"` test:

```ts
  it("sanitizes activeView to a known section", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airlock-prefs-"));
    const file = path.join(dir, "prefs.json");
    await writeFile(file, JSON.stringify({ activeView: "nonsense" }));
    expect((await loadPrefs(file)).activeView).toBe("files");
    await savePrefs(file, { activeView: "git" });
    expect((await loadPrefs(file)).activeView).toBe("git");
  });
```

- [ ] **Step 2.2: Run it — expect failure**

Run: `cd packages/app && npx vitest run src/main/prefs.test.ts`
Expected: FAIL — defaults `toEqual` mismatch (no `activeView` in loaded prefs) and TS error on the patch type.

- [ ] **Step 2.3: Implement**

In `packages/app/src/shared/ipc.ts`, inside `interface AppPrefs` directly under the `sectionVisibility` line, add:

```ts
  activeView: Section; // app-global; the sidebar view the activity bar shows
```

In `packages/app/src/main/prefs.ts`:

(a) `DEFAULTS`, under `sectionVisibility: { ...DEFAULT_SECTION_VISIBILITY },`:

```ts
  activeView: "files",
```

(b) In `sanitize()`, under the `sectionVisibility: sanitizeSectionVisibility(...)` line:

```ts
    activeView: SECTIONS.includes(r.activeView as Section)
      ? (r.activeView as Section)
      : "files",
```

In `packages/app/src/renderer/src/lib/usePrefs.ts`:

(a) Add the selector next to the others:

```ts
  const setActiveView = useApp((s) => s.setActiveView);
```

(b) In the hydrate `.then`, after `setSectionVisibility(p.sectionVisibility);`:

```ts
        setActiveView(p.activeView);
```

(c) Add `setActiveView` to the effect dependency array.

In `packages/app/src/renderer/src/App.smoke.test.tsx`, in the `DEFAULT_PREFS: AppPrefs` literal under `sectionVisibility: { ... }`, add:

```ts
  activeView: "files",
```

- [ ] **Step 2.4: Run tests + typecheck — expect pass**

Run: `cd packages/app && npx vitest run src/main/prefs.test.ts src/renderer/src/App.smoke.test.tsx && cd ../.. && npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 2.5: Commit**

```bash
git add packages/app/src/shared/ipc.ts packages/app/src/main/prefs.ts packages/app/src/main/prefs.test.ts packages/app/src/renderer/src/lib/usePrefs.ts packages/app/src/renderer/src/App.smoke.test.tsx
git commit -m "feat(prefs): persist the sidebar's active view (activeView)"
```

---

### Task 3: ActivityBar component

**Files:**
- Create: `packages/app/src/renderer/src/components/ActivityBar.tsx`
- Create: `packages/app/src/renderer/src/components/ActivityBar.test.tsx`

- [ ] **Step 3.1: Write the failing test**

Create `packages/app/src/renderer/src/components/ActivityBar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { ActivityBar } from "./ActivityBar";

const initialState = useApp.getState();
let prefsSet: ReturnType<typeof vi.fn>;
let setSectionVisibility: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useApp.setState(initialState, true);
  prefsSet = vi.fn(() => Promise.resolve());
  setSectionVisibility = vi.fn(() => Promise.resolve());
  // Minimal stub: ActivityBar itself only calls prefsSet/setSectionVisibility;
  // "on*" subscriptions return an unsubscribe; everything else resolves
  // undefined (the popovers' mount-time fetches land here harmlessly).
  window.airlock = new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop === "prefsSet"
          ? prefsSet
          : prop === "setSectionVisibility"
            ? setSectionVisibility
            : prop.startsWith("on")
              ? () => () => {}
              : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
});

afterEach(cleanup);

it("renders one icon per visible section and skips hidden ones", () => {
  useApp.setState({
    sectionVisibility: {
      ...useApp.getState().sectionVisibility,
      docker: false,
    },
  });
  render(<ActivityBar />);
  expect(screen.getByTitle("Files")).toBeTruthy();
  expect(screen.getByTitle("Git")).toBeTruthy();
  expect(screen.queryByTitle("Docker")).toBeNull();
});

it("click on an inactive icon activates that view and persists it", () => {
  render(<ActivityBar />);
  fireEvent.click(screen.getByTitle("Git"));
  expect(useApp.getState().activeView).toBe("git");
  expect(prefsSet).toHaveBeenCalledWith({
    activeView: "git",
    sidebarVisible: true,
  });
});

it("click on the active icon collapses the sidebar (and persists)", () => {
  render(<ActivityBar />);
  fireEvent.click(screen.getByTitle("Files")); // active by default
  expect(useApp.getState().sidebarVisible).toBe(false);
  expect(prefsSet).toHaveBeenCalledWith({ sidebarVisible: false });
});

it("click on any icon while the sidebar is hidden re-shows it", () => {
  useApp.setState({ sidebarVisible: false });
  render(<ActivityBar />);
  fireEvent.click(screen.getByTitle("Files"));
  expect(useApp.getState().sidebarVisible).toBe(true);
  expect(useApp.getState().activeView).toBe("files");
});

it("right-click offers Hide <Section> wired to setSectionVisibility", () => {
  render(<ActivityBar />);
  fireEvent.contextMenu(screen.getByTitle("Git"));
  fireEvent.click(screen.getByText("Hide Git"));
  expect(setSectionVisibility).toHaveBeenCalledWith("git", false);
});

it("renders the global Accounts/Settings buttons; Settings opens its menu", () => {
  render(<ActivityBar />);
  expect(screen.getByTitle("Accounts")).toBeTruthy();
  fireEvent.click(screen.getByTitle("Settings"));
  expect(screen.getByText("Themes")).toBeTruthy();
});
```

- [ ] **Step 3.2: Run it — expect failure**

Run: `cd packages/app && npx vitest run src/renderer/src/components/ActivityBar.test.tsx`
Expected: FAIL — module `./ActivityBar` not found.

- [ ] **Step 3.3: Implement**

Create `packages/app/src/renderer/src/components/ActivityBar.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { Section } from "../../../shared/ipc";
import { SECTION_META, effectiveView } from "../lib/sections";
import { useApp } from "../store";
import { AccountsPopover } from "./AccountsPopover";
import { SettingsMenu } from "./SettingsMenu";

// The vertical icon rail at the window edge: one icon per VISIBLE sidebar
// section. Click = show that view (re-opening the sidebar if collapsed); click
// the active icon = collapse the sidebar (same sidebarVisible flag the layout
// button and View menu drive -- no second collapse state). Right-click = hide
// the section (same action the old accordion header offered). The app-global
// Accounts/Settings buttons live at the rail bottom, rendered once per window.
export function ActivityBar() {
  const vis = useApp((s) => s.sectionVisibility);
  const activeView = useApp((s) => s.activeView);
  const sidebarVisible = useApp((s) => s.sidebarVisible);
  const [open, setOpen] = useState<"accounts" | "settings" | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    id: Section;
    label: string;
  } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const view = effectiveView(activeView, vis);

  const onIcon = (id: Section) => {
    const s = useApp.getState();
    // A user choice must survive a still-in-flight startup prefs hydrate (the
    // same race the layout buttons guard against).
    s.setLayoutHydrated(true);
    if (id === view && sidebarVisible) {
      s.setSidebarVisible(false);
      void window.airlock.prefsSet({ sidebarVisible: false });
      return;
    }
    s.setActiveView(id);
    if (!sidebarVisible) s.setSidebarVisible(true);
    void window.airlock.prefsSet({ activeView: id, sidebarVisible: true });
  };

  return (
    <nav className="activity-bar">
      <div className="activity-bar-icons">
        {SECTION_META.filter((m) => vis[m.id]).map((m) => (
          <button
            key={m.id}
            type="button"
            className={`activity-icon${m.id === view && sidebarVisible ? " active" : ""}`}
            title={m.label}
            onClick={() => onIcon(m.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, id: m.id, label: m.label });
            }}
          >
            <i className={`codicon codicon-${m.icon}`} />
          </button>
        ))}
      </div>
      <div className="activity-bar-bottom">
        {open !== null && (
          <button
            type="button"
            className="popover-backdrop"
            aria-label="Close menu"
            onClick={() => setOpen(null)}
          />
        )}
        <button
          type="button"
          className={`footer-btn${open === "accounts" ? " active" : ""}`}
          title="Accounts"
          onClick={() => setOpen(open === "accounts" ? null : "accounts")}
        >
          <i className="codicon codicon-account" />
        </button>
        <button
          type="button"
          className={`footer-btn${open === "settings" ? " active" : ""}`}
          title="Settings"
          onClick={() => setOpen(open === "settings" ? null : "settings")}
        >
          <i className="codicon codicon-gear" />
        </button>
        {open === "accounts" && (
          <AccountsPopover onClose={() => setOpen(null)} />
        )}
        {open === "settings" && <SettingsMenu onClose={() => setOpen(null)} />}
      </div>
      {menu && (
        <>
          <button
            type="button"
            className="popover-backdrop"
            aria-label="Close menu"
            onClick={() => setMenu(null)}
          />
          <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                void window.airlock.setSectionVisibility(menu.id, false);
                setMenu(null);
              }}
            >
              <span>Hide {menu.label}</span>
            </button>
          </div>
        </>
      )}
    </nav>
  );
}
```

- [ ] **Step 3.4: Run the test — expect pass**

Run: `cd packages/app && npx vitest run src/renderer/src/components/ActivityBar.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 3.5: Commit**

```bash
git add packages/app/src/renderer/src/components/ActivityBar.tsx packages/app/src/renderer/src/components/ActivityBar.test.tsx
git commit -m "feat(ui): activity bar rail with view switching and global buttons"
```

---

### Task 4: Rewrite Sidebar as a single-view panel

**Files:**
- Modify: `packages/app/src/renderer/src/components/Sidebar.tsx` (full rewrite)
- Create: `packages/app/src/renderer/src/components/Sidebar.test.tsx`

- [ ] **Step 4.1: Write the failing test**

Create `packages/app/src/renderer/src/components/Sidebar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { SECTION_META } from "../lib/sections";
import { useApp } from "../store";
import { Sidebar } from "./Sidebar";

const initialState = useApp.getState();

beforeEach(() => {
  useApp.setState(initialState, true);
  // Sections only hit window.airlock lazily (fetch-on-mount paths); a resolve-
  // undefined Proxy keeps any of them harmless, mirroring App.smoke.test.tsx.
  window.airlock = new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop.startsWith("on")
          ? () => () => {}
          : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
});

afterEach(cleanup);

// Minimal per-tab state: Sidebar itself only reads tabState[tabId]?.root.
const pane = (root: string | null) =>
  ({ root }) as unknown as (typeof initialState.tabState)[string];

it("shows the active view's title and only that view", () => {
  useApp.getState().setActiveView("secrets");
  render(<Sidebar />);
  expect(screen.getByText("Secrets")).toBeTruthy();
  expect(screen.queryByText("Open Folder…")).toBeNull(); // files view absent
});

it("files view without a root offers Open Folder", () => {
  useApp.getState().setActiveView("files");
  render(<Sidebar />);
  expect(screen.getByText("Files")).toBeTruthy();
  expect(screen.getByText("Open Folder…")).toBeTruthy();
});

it("falls back to the first visible view when the active one is hidden", () => {
  useApp.getState().setActiveView("git");
  useApp.setState({
    sectionVisibility: {
      ...useApp.getState().sectionVisibility,
      git: false,
    },
  });
  render(<Sidebar />);
  expect(screen.getByText("Files")).toBeTruthy();
});

it("shows the hidden-everything note when no section is visible", () => {
  useApp.setState({
    sectionVisibility: Object.fromEntries(
      SECTION_META.map((m) => [m.id, false]),
    ) as (typeof initialState)["sectionVisibility"],
  });
  render(<Sidebar />);
  expect(screen.getByText(/All sections hidden/)).toBeTruthy();
});

it("renders the quota meter exactly once", () => {
  useApp.setState({ quotaMeterEnabled: true, quota: null });
  const { container } = render(<Sidebar />);
  expect(container.querySelectorAll(".quota-meter").length).toBe(1);
});

it("badges the focused pane's project name while a split is showing", () => {
  const t1 = useApp.getState().activeTabId;
  useApp.setState({
    tabs: [
      { id: t1, root: "/tmp/projA" },
      { id: "t2", root: "/tmp/projB" },
    ],
    split: { a: t1, b: "t2" },
    activeTabId: "t2",
    tabState: {
      ...useApp.getState().tabState,
      [t1]: pane("/tmp/projA"),
      t2: pane("/tmp/projB"),
    },
  });
  render(<Sidebar />);
  expect(screen.getByText("projB")).toBeTruthy(); // focused pane's basename
});
```

- [ ] **Step 4.2: Run it — expect failure**

Run: `cd packages/app && npx vitest run src/renderer/src/components/Sidebar.test.tsx`
Expected: FAIL — old Sidebar renders ALL sections (e.g. "Open Folder…" present in the secrets test, no project badge, etc.).

- [ ] **Step 4.3: Implement — full rewrite of `Sidebar.tsx`**

Replace the entire contents of `packages/app/src/renderer/src/components/Sidebar.tsx` with:

```tsx
import type { ReactNode } from "react";
import { openPickedFolder } from "../lib/openFolder";
import { useProjectTab } from "../lib/projectPane";
import { SECTION_META, effectiveView } from "../lib/sections";
import { useApp } from "../store";
import { ActivitySection } from "./ActivitySection";
import { AuditSection } from "./AuditSection";
import { DatabasesSection } from "./DatabasesSection";
import { DockerSection } from "./DockerSection";
import { FileTree } from "./FileTree";
import { GitSection } from "./GitSection";
import { LocalHostSection } from "./LocalHostSection";
import { NeonSection } from "./NeonSection";
import { QuotaMeter } from "./QuotaMeter";
import { RenderSection } from "./RenderSection";
import { SecretsSection } from "./SecretsSection";

// THE sidebar: one per window (rendered by App, beside the ActivityBar), not
// one per pane. It shows a single view -- the activity bar's active section --
// and is always bound to the FOCUSED pane's project: with no ProjectPaneContext
// provider above it, useProjectTab() falls back to activeTabId, the same
// "focused pane drives everything" rule the agent, menus, and title follow.
export function Sidebar() {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const vis = useApp((s) => s.sectionVisibility);
  const activeView = useApp((s) => s.activeView);
  const requestNewFile = useApp((s) => s.requestNewFile);
  const split = useApp((s) => s.split);
  const activeTabId = useApp((s) => s.activeTabId);

  const view = effectiveView(activeView, vis);
  const meta = SECTION_META.find((m) => m.id === view) ?? null;
  // Badge the project only while the split is on screen (two projects visible
  // -> say which one the sidebar reflects). Single pane needs no reminder.
  const splitShowing =
    split !== null && (activeTabId === split.a || activeTabId === split.b);

  const openFolder = async () => {
    try {
      const picked = await window.airlock.openFolder();
      if (picked) await openPickedFolder(picked);
    } catch (err) {
      console.error("openFolder failed", err);
    }
  };

  let body: ReactNode = null;
  if (view === "files") {
    body = root ? (
      <FileTree />
    ) : (
      <button type="button" className="open-folder" onClick={openFolder}>
        Open Folder…
      </button>
    );
  } else if (view === "secrets") body = <SecretsSection />;
  else if (view === "git") body = <GitSection />;
  else if (view === "activity") body = <ActivitySection />;
  else if (view === "databases")
    body = (
      <>
        <NeonSection />
        <DatabasesSection />
      </>
    );
  else if (view === "docker") body = <DockerSection />;
  else if (view === "host")
    body = (
      <>
        <LocalHostSection />
        <RenderSection />
      </>
    );
  else if (view === "audit") body = <AuditSection />;

  return (
    <aside className="sidebar">
      {meta ? (
        <>
          <div className="sidebar-view-header">
            <span className="sidebar-view-title">{meta.label}</span>
            {splitShowing && root && (
              <span className="sidebar-view-project" title={root}>
                {root.split("/").pop()}
              </span>
            )}
            {view === "files" && root && (
              <span className="section-actions">
                <button
                  type="button"
                  className="section-action"
                  title="New File"
                  onClick={() => requestNewFile(tabId, "file")}
                >
                  <i className="codicon codicon-new-file" />
                </button>
                <button
                  type="button"
                  className="section-action"
                  title="New Folder"
                  onClick={() => requestNewFile(tabId, "dir")}
                >
                  <i className="codicon codicon-new-folder" />
                </button>
              </span>
            )}
          </div>
          <div className="sidebar-view-body">{body}</div>
        </>
      ) : (
        <div className="sidebar-empty">
          All sections hidden. Re-enable them from View → Sidebar.
        </div>
      )}
      <QuotaMeter />
    </aside>
  );
}
```

Note: `requestNewFile` already exists in the store (the old Sidebar used it identically).

- [ ] **Step 4.4: Run the tests — expect pass**

Run: `cd packages/app && npx vitest run src/renderer/src/components/Sidebar.test.tsx src/renderer/src/App.smoke.test.tsx`
Expected: PASS. (The smoke test still mounts the OLD composition — ProjectPane renders the new Sidebar in the old grid; nothing asserted on accordion internals.)

- [ ] **Step 4.5: Commit**

```bash
git add packages/app/src/renderer/src/components/Sidebar.tsx packages/app/src/renderer/src/components/Sidebar.test.tsx
git commit -m "feat(ui): sidebar shows one active view with header + project badge"
```

---

### Task 5: Compose at App level; pane sheds its sidebar; CSS

**Files:**
- Modify: `packages/app/src/renderer/src/App.tsx`
- Modify: `packages/app/src/renderer/src/components/ProjectPane.tsx`
- Delete: `packages/app/src/renderer/src/components/SidebarFooter.tsx`
- Modify: `packages/app/src/renderer/src/theme.css`
- Modify: `packages/app/src/renderer/src/App.smoke.test.tsx`

- [ ] **Step 5.1: Extend the smoke test (failing first)**

In `App.smoke.test.tsx`, inside the `"mounts <App/> without crashing"` test, after the `.project-pane` assertion add:

```ts
  // New chrome: the activity bar and exactly ONE shared sidebar.
  expect(container.querySelector(".activity-bar")).toBeTruthy();
  expect(container.querySelectorAll(".sidebar").length).toBe(1);
```

And in the `"keeps terminals alive across a split toggle"` test, right after the first `toggleProjectSplit()` `act` block's `expect(ptyKillCalls).toBe(0);` add:

```ts
  // The split must NOT duplicate the sidebar: one shared instance, always.
  expect(document.querySelectorAll(".sidebar").length).toBe(1);
```

- [ ] **Step 5.2: Run it — expect failure**

Run: `cd packages/app && npx vitest run src/renderer/src/App.smoke.test.tsx`
Expected: FAIL — no `.activity-bar`; two `.sidebar`s after the split toggle.

- [ ] **Step 5.3: Implement App.tsx**

In `packages/app/src/renderer/src/App.tsx`:

(a) Add imports:

```ts
import { ActivityBar } from "./components/ActivityBar";
import { Sidebar } from "./components/Sidebar";
```

(b) Add selectors next to the existing ones:

```ts
  const sidebarVisible = useApp((s) => s.sidebarVisible);
  const sidebarPosition = useApp((s) => s.sidebarPosition);
```

(c) Replace the pane block

```tsx
        {showSplit && split ? (
          <div className="project-split">
            <ProjectPane tabId={split.a} focused={activeTabId === split.a} />
            <ProjectPane tabId={split.b} focused={activeTabId === split.b} />
          </div>
        ) : (
          <ProjectPane tabId={activeTabId} focused />
        )}
```

with the workspace row (rail + ONE sidebar + panes):

```tsx
        <div
          className={`workspace${sidebarPosition === "right" ? " sidebar-right" : ""}${sidebarVisible ? "" : " sidebar-hidden"}`}
        >
          <ActivityBar />
          {/* One sidebar per window, bound to the focused pane: no pane
              provider wraps it, so useProjectTab() inside falls back to
              activeTabId. */}
          <Sidebar />
          {showSplit && split ? (
            <div className="project-split">
              <ProjectPane tabId={split.a} focused={activeTabId === split.a} />
              <ProjectPane tabId={split.b} focused={activeTabId === split.b} />
            </div>
          ) : (
            <ProjectPane tabId={activeTabId} focused />
          )}
        </div>
```

- [ ] **Step 5.4: Implement ProjectPane.tsx**

(a) Remove the `Sidebar` import and the `sidebarPosition` / `sidebarVisible` selectors (lines 36-37).

(b) Replace the returned JSX

```tsx
      <div
        className={`layout${sidebarPosition === "right" ? " sidebar-right" : ""}${sidebarVisible ? "" : " sidebar-hidden"}`}
      >
        <Sidebar />
        <div className="main">
          <MainTabs tabId={tabId} />
          <div className={`main-content${split ? " main-panes split" : ""}`}>
            {content}
          </div>
        </div>
      </div>
```

with:

```tsx
      <div className="main">
        <MainTabs tabId={tabId} />
        <div className={`main-content${split ? " main-panes split" : ""}`}>
          {content}
        </div>
      </div>
```

(c) Update the component docblock's first line to say the pane is "a unified main area scoped to a single tab (the window's single sidebar lives in App)".

- [ ] **Step 5.5: Delete SidebarFooter**

```bash
git rm packages/app/src/renderer/src/components/SidebarFooter.tsx
```

- [ ] **Step 5.6: CSS**

In `packages/app/src/renderer/src/theme.css`:

(a) Replace the `.layout` block (~line 290)

```css
.layout {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  min-height: 0;
}
```

with:

```css
/* Window-level workspace row: icon rail | ONE shared sidebar | panes. The rail
   is always visible; sidebar-hidden collapses only the sidebar column; the
   sidebar-right variant flips the reading order via `order`. */
.workspace {
  display: grid;
  grid-template-columns: 44px 230px minmax(0, 1fr);
  min-height: 0;
}

.workspace > .project-pane,
.workspace > .project-split {
  min-width: 0;
  min-height: 0;
}

.activity-bar {
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
}

.activity-bar-icons {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.activity-icon {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  background: none;
  border: none;
  color: var(--fg-dim);
  cursor: pointer;
}

.activity-icon:hover,
.activity-icon.active {
  color: var(--fg);
}

.activity-icon .codicon {
  font-size: 20px;
}

/* Active-view indicator: the standard left-edge bar. */
.activity-icon.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 2px;
  background: var(--accent);
}

.workspace.sidebar-right .activity-icon.active::before {
  left: auto;
  right: 0;
}

/* Rail bottom: the app-global Accounts/Settings buttons; position:relative
   anchors their bottom-sheet popovers (which overlay the sidebar beside it). */
.activity-bar-bottom {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 0;
  border-top: 1px solid var(--border);
}

/* The sidebar's single-view chrome. */
.sidebar-view-header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 6px;
}

.sidebar-view-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fg-dim);
}

.sidebar-view-project {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--fg-dim);
  opacity: 0.8;
}

.sidebar-view-header .section-actions {
  margin-left: auto;
}

.sidebar-view-header:hover .section-actions {
  opacity: 1;
}

.sidebar-view-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-bottom: 8px;
}
```

(b) Delete the `.project-pane > .layout` rule (~line 317) and give `.project-pane` the pane-fill itself — replace

```css
.project-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.project-pane > .layout {
  flex: 1 1 0;
  min-height: 0;
}
```

with:

```css
.project-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.project-pane > .main {
  flex: 1 1 0;
  min-height: 0;
}
```

(c) Replace the sidebar-position rules (~lines 752-773)

```css
.layout.sidebar-right { ... }
.layout.sidebar-right .sidebar { ... }
.layout.sidebar-right .main { ... }
.layout.sidebar-hidden { ... }
.layout.sidebar-hidden .sidebar { ... }
```

with:

```css
.workspace.sidebar-right {
  grid-template-columns: minmax(0, 1fr) 230px 44px;
}

.workspace.sidebar-right .activity-bar {
  order: 3;
  border-right: none;
  border-left: 1px solid var(--border);
}

.workspace.sidebar-right .sidebar {
  order: 2;
  border-right: none;
  border-left: 1px solid var(--border);
}

.workspace.sidebar-right > .project-pane,
.workspace.sidebar-right > .project-split {
  order: 1;
}

/* Popovers anchored in a right-side rail must open leftward. */
.workspace.sidebar-right .activity-bar-bottom .popover {
  left: auto;
  right: 8px;
}

/* Sidebar hidden: drop only the sidebar column; the rail stays. */
.workspace.sidebar-hidden {
  grid-template-columns: 44px minmax(0, 1fr);
}

.workspace.sidebar-hidden.sidebar-right {
  grid-template-columns: minmax(0, 1fr) 44px;
}

.workspace.sidebar-hidden .sidebar {
  display: none;
}
```

(d) Delete the `.sidebar-footer` block (~lines 780-787) — keep `.footer-btn` rules (reused by the rail).

(e) Delete the now-dead accordion rules — `.sidebar-sections` (~339), `.section` (~347), `.section-header` (~352), `.section-header-toggle` (~357) and its `:hover`, `.section:hover .section-actions` (~386), `.section-header .codicon` (~411), `.section-title` (~423), `.section-body` (~430). **Before each deletion**, verify the class no longer appears in any `.tsx`: `rg -l "section-header|sidebar-sections|section-title|section-body" packages/app/src` — if a section component uses one internally, keep that rule. Keep `.section-actions`, `.section-action`, and `.section-note` (still used).

(f) Update the comment on `.popover` (~line 879) from "above the footer" to "above the rail's bottom buttons".

- [ ] **Step 5.7: Run the suite — expect pass**

Run: `cd packages/app && npx vitest run src/renderer/src && cd ../.. && npm run typecheck`
Expected: all renderer tests PASS (smoke asserts one sidebar + rail), typecheck clean (deleting SidebarFooter must leave no dangling imports — `rg SidebarFooter packages/app/src` must return nothing).

- [ ] **Step 5.8: Commit**

```bash
git add -A packages/app/src/renderer
git commit -m "feat(ui): single shared sidebar + activity bar composed at App level

The project split no longer duplicates the sidebar: ProjectPane sheds its
per-pane Sidebar/.layout wrapper, App renders rail + one sidebar bound to
the focused pane, SidebarFooter folds into the rail bottom."
```

---

### Task 6: Palette "Show <Section>" commands

**Files:**
- Modify: `packages/app/src/renderer/src/lib/commands.ts`
- Create: `packages/app/src/renderer/src/lib/commands.test.ts`

- [ ] **Step 6.1: Write the failing test**

Create `packages/app/src/renderer/src/lib/commands.test.ts` (jsdom: the command
bodies call `window.airlock`, which node-environment suites don't have):

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { buildCommands } from "./commands";

const initialState = useApp.getState();
let prefsSet: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useApp.setState(initialState, true);
  prefsSet = vi.fn(() => Promise.resolve());
  window.airlock = new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop === "prefsSet" ? prefsSet : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
});

afterEach(() => useApp.setState(initialState, true));

it("offers Show <Section> commands that activate the view", () => {
  useApp.setState({ sidebarVisible: false });
  const cmds = buildCommands(useApp.getState(), () => {});
  const show = cmds.find((c) => c.id === "show-section-git");
  expect(show?.title).toBe("Show Git");
  show?.run();
  expect(useApp.getState().activeView).toBe("git");
  expect(useApp.getState().sidebarVisible).toBe(true);
  expect(prefsSet).toHaveBeenCalledWith({
    activeView: "git",
    sidebarVisible: true,
  });
});

it("omits Show commands for hidden sections but keeps their toggles", () => {
  useApp.setState({
    sectionVisibility: {
      ...useApp.getState().sectionVisibility,
      git: false,
    },
  });
  const cmds = buildCommands(useApp.getState(), () => {});
  expect(cmds.find((c) => c.id === "show-section-git")).toBeUndefined();
  expect(cmds.find((c) => c.id === "toggle-section-git")).toBeTruthy();
});
```

- [ ] **Step 6.2: Run it — expect failure**

Run: `cd packages/app && npx vitest run src/renderer/src/lib/commands.test.ts`
Expected: FAIL — no `show-section-git` command.

- [ ] **Step 6.3: Implement**

In `packages/app/src/renderer/src/lib/commands.ts`:

(a) Delete the local `SECTIONS` array and its `Section` type import; import the shared metadata instead:

```ts
import { SECTION_META } from "./sections";
```

(b) Replace the existing toggle-section loop

```ts
  for (const sec of SECTIONS) {
    const visible = s.sectionVisibility[sec.id];
    cmds.push({
      id: `toggle-section-${sec.id}`,
      title: `Toggle ${sec.label} Section`,
      run: () => {
        void window.airlock.setSectionVisibility(sec.id, !visible);
      },
    });
  }
```

with:

```ts
  for (const sec of SECTION_META) {
    if (s.sectionVisibility[sec.id]) {
      cmds.push({
        id: `show-section-${sec.id}`,
        title: `Show ${sec.label}`,
        run: () => {
          s.setLayoutHydrated(true);
          s.setActiveView(sec.id);
          if (!s.sidebarVisible) s.setSidebarVisible(true);
          void window.airlock.prefsSet({
            activeView: sec.id,
            sidebarVisible: true,
          });
        },
      });
    }
    const visible = s.sectionVisibility[sec.id];
    cmds.push({
      id: `toggle-section-${sec.id}`,
      title: `Toggle ${sec.label} Section`,
      run: () => {
        void window.airlock.setSectionVisibility(sec.id, !visible);
      },
    });
  }
```

- [ ] **Step 6.4: Run the test — expect pass**

Run: `cd packages/app && npx vitest run src/renderer/src/lib/commands.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6.5: Commit**

```bash
git add packages/app/src/renderer/src/lib/commands.ts packages/app/src/renderer/src/lib/commands.test.ts
git commit -m "feat(palette): Show <Section> commands switch the sidebar view"
```

---

### Task 7: Docs + full verification

**Files:**
- Modify: `CLAUDE.md` (quota gotcha line)
- Modify: `docs/superpowers/specs/2026-06-09-activity-bar-ui-design.md` (status line)

- [ ] **Step 7.1: Update CLAUDE.md**

Replace the line

```
**Account-wide, not per-project.** ANY Claude session on the machine feeds the
  one meter (the statusLine is global). In a split scene it renders **once** —
  `Sidebar.tsx` hides it on the secondary pane (`tabId === split.b`).
```

with:

```
**Account-wide, not per-project.** ANY Claude session on the machine feeds the
  one meter (the statusLine is global). It renders **once** in the window's
  single shared sidebar (activity-bar layout; the sidebar follows the focused
  pane).
```

- [ ] **Step 7.2: Mark the spec implemented**

In the spec header, change `**Status:** Approved by owner mandate ...` to append `Implemented on feat/ui-activity-bar.`

- [ ] **Step 7.3: Full gates**

Run from repo root:

```bash
npm test && npm run typecheck && npm run lint
```

Expected: all suites green, typecheck clean, biome clean. Fix anything that surfaces before committing.

- [ ] **Step 7.4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-06-09-activity-bar-ui-design.md docs/superpowers/plans/2026-06-09-activity-bar-ui.md
git commit -m "docs: activity-bar layout notes (quota gotcha, spec status, plan)"
```

---

## Self-review notes

- **Spec coverage:** rail + click semantics (T3), visibility gating (T3/T4), single shared sidebar bound to focus (T4/T5), project badge (T4), quota dedup removal (T4/T5), footer fold-in (T3/T5), palette commands (T6), prefs persistence + sanitize (T2), fallback rule (T1), CLAUDE.md rider (T7). View-menu/MCP paths intentionally untouched (they only write `sectionVisibility`).
- **Type consistency:** `activeView: Section`, `setActiveView(v: Section)`, `effectiveView(active: Section, vis: SectionVisibility): Section | null`, `SECTION_META: {id; label; icon}[]` used identically in T1/T3/T4/T6.
- **Known transitional state:** after T4 (before T5) the app briefly renders the new single-view sidebar inside the old per-pane layout with no footer; all gates stay green, and T5 lands the final composition in the same session.
