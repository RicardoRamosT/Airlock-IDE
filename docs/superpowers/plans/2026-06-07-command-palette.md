# Command / Quick-Open Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single fuzzy modal powering Cmd+P quick-open (jump to any file in the focused project) and Cmd+Shift+P command palette (run a registered action).

**Architecture:** A pure fuzzy matcher + a recursive file source feed one modal with two modes (`files`/`commands`, `>` toggles). The shortcuts are real app-menu accelerators routed through the existing menu -> `menu:action` -> `useMenuActions` path; the modal is window-level in `App`, targets the active project (`activeTabId`), and opens files via `openEditorFile`.

**Tech Stack:** Electron + electron-vite, React 19, Zustand, TypeScript (strict), vitest, biome.

**Spec:** `docs/superpowers/specs/2026-06-07-command-palette-design.md`

---

## Conventions for every task

- **ASCII-only** in `packages/agent-core/**`, `packages/app/src/main/**`,
  `packages/app/src/preload/**`, `packages/app/src/shared/ipc.ts` (CJS bundling;
  use `--`, never em-dashes). Renderer `.tsx`/`.css`/`.ts` and this plan are exempt.
- Commands (run from repo root `/Users/ricardoramos/Projects/airlock`): one test
  file `npx vitest run <path>`; typecheck `npm run typecheck`; lint
  `npx biome check --write <paths>` then `npx biome check <paths>`.
- Branch: `feat/command-palette` (already created). Do NOT push.

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `packages/agent-core/src/workspace/tree.ts` | `listFilesRecursive` (flat relpaths, IGNORED-pruned, capped) | 1 |
| `packages/agent-core/src/index.ts` | export it | 1 |
| `packages/app/src/renderer/src/lib/fuzzy.ts` (new) | pure `fuzzyScore` + `fuzzyFilter` | 2 |
| `packages/app/src/shared/ipc.ts` | `MenuAction` += quick-open/command-palette; `listAllFiles` | 3 |
| `packages/app/src/preload/index.ts` | wire `fs:listAll` | 3 |
| `packages/app/src/main/ipc.ts` | `fs:listAll` handler | 3 |
| `packages/app/src/main/menu.ts` | "Go" submenu (Cmd+P / Cmd+Shift+P) | 3 |
| `packages/app/src/renderer/src/store.ts` | `palette` state + open/close | 4 |
| `packages/app/src/renderer/src/lib/useMenuActions.ts` | open palette on the two actions | 4 |
| `packages/app/src/renderer/src/lib/commands.ts` (new) | `buildCommands` registry | 5 |
| `packages/app/src/renderer/src/components/Palette.tsx` (new) | the modal (UI + file cache) | 6 |
| `packages/app/src/renderer/src/App.tsx` | mount `<Palette/>` | 6 |
| `packages/app/src/renderer/src/theme.css` | palette styles | 6 |

---

## Task 1: agent-core recursive file lister

**Files:**
- Modify: `packages/agent-core/src/workspace/tree.ts`
- Modify: `packages/agent-core/src/index.ts`
- Test: `packages/agent-core/src/workspace/tree.test.ts`

- [ ] **Step 1: Write the failing test.**

Add to `packages/agent-core/src/workspace/tree.test.ts` (add `mkdirSync`/`writeFileSync` to its `node:fs` import if missing, and `listFilesRecursive` to its `./tree` import):

```ts
it("listFilesRecursive returns nested relpaths and prunes IGNORED dirs", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "airlock-listall-"));
  mkdirSync(path.join(root, "src"));
  mkdirSync(path.join(root, "node_modules"));
  mkdirSync(path.join(root, ".git"));
  writeFileSync(path.join(root, "a.ts"), "");
  writeFileSync(path.join(root, "src", "b.ts"), "");
  writeFileSync(path.join(root, "node_modules", "skip.js"), "");
  writeFileSync(path.join(root, ".git", "HEAD"), "");
  const r = await listFilesRecursive(root);
  expect(r.files).toEqual(["a.ts", "src/b.ts"]);
  expect(r.truncated).toBe(false);
});

it("listFilesRecursive caps at max and reports truncated", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "airlock-listcap-"));
  for (let i = 0; i < 5; i++) writeFileSync(path.join(root, `f${i}.ts`), "");
  const r = await listFilesRecursive(root, 3);
  expect(r.files).toHaveLength(3);
  expect(r.truncated).toBe(true);
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `npx vitest run packages/agent-core/src/workspace/tree.test.ts`
Expected: FAIL -- `listFilesRecursive` is not exported.

- [ ] **Step 3: Implement `listFilesRecursive` in `tree.ts`.**

Add `readdir` is already imported. Append after `listDirectory`:

```ts
export interface FileList {
  files: string[];
  truncated: boolean;
}

// Recursively list FILE relpaths under root (POSIX separators), honoring the
// IGNORED set so node_modules/.git/.airlock/dist/out are pruned. Stops at `max`
// and sets truncated. Dirents use lstat semantics, so a symlink is neither a
// dir nor a file here -- symlinks are skipped, which also prevents cycles.
// Results are name-sorted at each level for determinism. ASCII-only file.
export async function listFilesRecursive(
  root: string,
  max = 10000,
): Promise<FileList> {
  const realRoot = await realpath(path.resolve(root));
  const files: string[] = [];
  let truncated = false;
  async function walk(absDir: string, relDir: string): Promise<void> {
    if (truncated) return;
    let dirents: Awaited<ReturnType<typeof readdir>>;
    try {
      dirents = await readdir(absDir, { withFileTypes: true });
    } catch {
      return; // unreadable dir -- skip
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirents) {
      if (IGNORED.has(d.name)) continue;
      const rel = relDir ? `${relDir}/${d.name}` : d.name;
      if (d.isDirectory()) {
        await walk(path.join(absDir, d.name), rel);
        if (truncated) return;
      } else if (d.isFile()) {
        if (files.length >= max) {
          truncated = true;
          return;
        }
        files.push(rel);
      }
    }
  }
  await walk(realRoot, "");
  return { files, truncated };
}
```

Note: `readdir` with `withFileTypes: true` returns `Dirent[]`; `Awaited<ReturnType<typeof readdir>>` is `Dirent[]` here because the call site fixes the overload -- if tsc complains, change the annotation to import `Dirent` from `node:fs` and use `Dirent[]`.

- [ ] **Step 4: Export it.**

In `packages/agent-core/src/index.ts`, change the `./workspace/tree` export block to include the new symbols:

```ts
export {
  type DirEntry,
  type FileList,
  listDirectory,
  listFilesRecursive,
  resolveWithin,
  targetsVault,
} from "./workspace/tree";
```

- [ ] **Step 5: Run tests + typecheck.**

Run: `npx vitest run packages/agent-core/src/workspace/tree.test.ts` -> PASS.
Run: `npm run typecheck` -> clean (if the `Awaited<...>` annotation errors, switch to the `Dirent[]` import per the Step 3 note and re-run).

- [ ] **Step 6: Lint + commit.**

```bash
npx biome check --write packages/agent-core/src/workspace/tree.ts packages/agent-core/src/workspace/tree.test.ts packages/agent-core/src/index.ts
git add packages/agent-core/src/workspace/tree.ts packages/agent-core/src/workspace/tree.test.ts packages/agent-core/src/index.ts
git commit -m "feat(palette): listFilesRecursive -- flat IGNORED-pruned file list"
```

---

## Task 2: pure fuzzy matcher

**Files:**
- Create: `packages/app/src/renderer/src/lib/fuzzy.ts`
- Test: `packages/app/src/renderer/src/lib/fuzzy.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `packages/app/src/renderer/src/lib/fuzzy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyScore } from "./fuzzy";

describe("fuzzyScore", () => {
  it("returns null when query is not a subsequence", () => {
    expect(fuzzyScore("xyz", "abc")).toBeNull();
  });
  it("empty query matches with score 0 and no indices", () => {
    expect(fuzzyScore("", "abc")).toEqual({ score: 0, indices: [] });
  });
  it("records matched indices, case-insensitively", () => {
    expect(fuzzyScore("ab", "AxBy")?.indices).toEqual([0, 2]);
  });
  it("scores consecutive higher than scattered", () => {
    const consec = fuzzyScore("ab", "abxx");
    const scattered = fuzzyScore("ab", "axbx");
    expect(consec && scattered && consec.score > scattered.score).toBe(true);
  });
  it("rewards word-boundary matches (separator + camelCase)", () => {
    const boundary = fuzzyScore("ft", "file_tree");
    const mid = fuzzyScore("ft", "soft");
    expect(boundary && mid && boundary.score > mid.score).toBe(true);
    expect(fuzzyScore("ft", "fileTree")?.indices).toEqual([0, 4]);
  });
});

describe("fuzzyFilter", () => {
  it("keeps matches, drops non-matches, sorts best first", () => {
    const out = fuzzyFilter("ft", ["soft", "file_tree", "zzz"], (s) => s);
    expect(out.map((o) => o.item)).toEqual(["file_tree", "soft"]);
  });
  it("empty query keeps all in original order", () => {
    const out = fuzzyFilter("", ["b", "a"], (s) => s);
    expect(out.map((o) => o.item)).toEqual(["b", "a"]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `npx vitest run packages/app/src/renderer/src/lib/fuzzy.test.ts`
Expected: FAIL -- module `./fuzzy` does not exist.

- [ ] **Step 3: Implement `fuzzy.ts`.**

Create `packages/app/src/renderer/src/lib/fuzzy.ts`:

```ts
export interface FuzzyMatch {
  score: number;
  indices: number[];
}

// True if position i in text starts a "word": index 0, just after a separator
// (/ \ _ - . space), or a lower->Upper camelCase edge.
function isBoundary(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1] ?? "";
  if (/[/\\_\-. ]/.test(prev)) return true;
  const cur = text[i] ?? "";
  return (
    prev === prev.toLowerCase() &&
    cur === cur.toUpperCase() &&
    cur !== cur.toLowerCase()
  );
}

// Case-insensitive subsequence fuzzy match. null if `query` is not a subsequence
// of `text`. Higher score = better; rewards consecutive runs and word-boundary
// hits. `indices` are matched positions in `text` (for highlighting). An empty
// query matches everything with score 0.
export function fuzzyScore(query: string, text: string): FuzzyMatch | null {
  if (query === "") return { score: 0, indices: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let qi = 0;
  let prev = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    let bonus = 1;
    if (ti === prev + 1) bonus += 2; // consecutive
    if (isBoundary(text, ti)) bonus += 3; // word boundary
    score += bonus;
    indices.push(ti);
    prev = ti;
    qi++;
  }
  if (qi < q.length) return null;
  return { score: score - text.length * 0.01, indices }; // tiny shorter-is-better tilt
}

// Score `items` by `key`, drop non-matches, sort best-first (then shorter key,
// then lexicographic for stability). Empty query preserves the input order.
export function fuzzyFilter<T>(
  query: string,
  items: T[],
  key: (t: T) => string,
): { item: T; match: FuzzyMatch }[] {
  const out: { item: T; match: FuzzyMatch }[] = [];
  for (const item of items) {
    const match = fuzzyScore(query, key(item));
    if (match) out.push({ item, match });
  }
  if (query !== "") {
    out.sort(
      (a, b) =>
        b.match.score - a.match.score ||
        key(a.item).length - key(b.item).length ||
        key(a.item).localeCompare(key(b.item)),
    );
  }
  return out;
}
```

- [ ] **Step 4: Run tests + typecheck.**

Run: `npx vitest run packages/app/src/renderer/src/lib/fuzzy.test.ts` -> PASS.
Run: `npm run typecheck` -> clean.

- [ ] **Step 5: Lint + commit.**

```bash
npx biome check --write packages/app/src/renderer/src/lib/fuzzy.ts packages/app/src/renderer/src/lib/fuzzy.test.ts
git add packages/app/src/renderer/src/lib/fuzzy.ts packages/app/src/renderer/src/lib/fuzzy.test.ts
git commit -m "feat(palette): zero-dep fuzzy matcher (fuzzyScore + fuzzyFilter)"
```

---

## Task 3: IPC surface + the "Go" menu

**Files:**
- Modify: `packages/app/src/shared/ipc.ts` (`MenuAction` ~line 125; `AirlockApi` after `trashFile`)
- Modify: `packages/app/src/preload/index.ts` (after `trashFile`)
- Modify: `packages/app/src/main/ipc.ts` (import + handler near the fs handlers)
- Modify: `packages/app/src/main/menu.ts` (template, after the View submenu)

- [ ] **Step 1: Extend `MenuAction` and `AirlockApi`.**

In `packages/app/src/shared/ipc.ts`, add to the `MenuAction` union:

```ts
  | { type: "quick-open" }
  | { type: "command-palette" }
```

And in `interface AirlockApi`, after the `trashFile(...)` line:

```ts
  // Flat list of every file relpath in the project (palette quick-open). Honors
  // the same IGNORED set as the tree; capped, with `truncated` set when hit.
  listAllFiles(root: string): Promise<{ files: string[]; truncated: boolean }>;
```

- [ ] **Step 2: Wire preload.**

In `packages/app/src/preload/index.ts`, after the `trashFile` line in the `api` object:

```ts
  listAllFiles: (root) => ipcRenderer.invoke("fs:listAll", root),
```

- [ ] **Step 3: Add the main handler.**

In `packages/app/src/main/ipc.ts`, add `listFilesRecursive` to the existing
`@airlock/agent-core` import, then after the `fs:listDir` handler add:

```ts
  ipcMain.handle("fs:listAll", (e, root: unknown) =>
    listFilesRecursive(resolveRoot(e, root)),
  );
```

- [ ] **Step 4: Add the "Go" submenu.**

In `packages/app/src/main/menu.ts`, in the `template` array inside `applyAppMenu`,
insert this object immediately after the `View` submenu object and before
`{ role: "windowMenu" }`:

```ts
    {
      label: "Go",
      submenu: [
        {
          label: "Go to File...",
          accelerator: "CmdOrCtrl+P",
          click: () => pushMenuAction({ type: "quick-open" }),
        },
        {
          label: "Command Palette...",
          accelerator: "CmdOrCtrl+Shift+P",
          click: () => pushMenuAction({ type: "command-palette" }),
        },
      ],
    },
```

- [ ] **Step 5: Verify.**

Run: `npm run typecheck` -> clean (the new `AirlockApi` method is implemented in preload).
Run: `npx vitest run packages/app/src/main/menu.test.ts` -> PASS (it tests the helper builders, not the full template, so the new submenu does not affect it).
Confirm ASCII-only: no multibyte chars in the four files (the comment uses `--`).

- [ ] **Step 6: Lint + commit.**

```bash
npx biome check --write packages/app/src/shared/ipc.ts packages/app/src/preload/index.ts packages/app/src/main/ipc.ts packages/app/src/main/menu.ts
git add packages/app/src/shared/ipc.ts packages/app/src/preload/index.ts packages/app/src/main/ipc.ts packages/app/src/main/menu.ts
git commit -m "feat(palette): fs:listAll IPC + Go menu (Cmd+P / Cmd+Shift+P)"
```

---

## Task 4: store palette state + trigger wiring

**Files:**
- Modify: `packages/app/src/renderer/src/store.ts` (interface near `setSettingsOpen`; impl near `bumpFsVersion`)
- Modify: `packages/app/src/renderer/src/lib/useMenuActions.ts`
- Test: `packages/app/src/renderer/src/store.palette.test.ts` (new)

- [ ] **Step 1: Write the failing test.**

Create `packages/app/src/renderer/src/store.palette.test.ts`:

```ts
import { afterEach, beforeEach, expect, it } from "vitest";
import { useApp } from "./store";

const initialState = useApp.getState();
beforeEach(() => useApp.setState(initialState, true));
afterEach(() => useApp.setState(initialState, true));

it("openPalette sets the mode, closePalette clears it", () => {
  expect(useApp.getState().palette).toBeNull();
  useApp.getState().openPalette("files");
  expect(useApp.getState().palette).toEqual({ mode: "files" });
  useApp.getState().openPalette("commands");
  expect(useApp.getState().palette).toEqual({ mode: "commands" });
  useApp.getState().closePalette();
  expect(useApp.getState().palette).toBeNull();
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `npx vitest run packages/app/src/renderer/src/store.palette.test.ts`
Expected: FAIL -- `openPalette` is not a function.

- [ ] **Step 3: Add the interface members.**

In `store.ts`, in `AppState` right after `setSettingsOpen: (v: boolean, tabId?: string) => void;`:

```ts
  // The command/quick-open palette overlay (window-level, one per window).
  palette: { mode: "files" | "commands" } | null;
  openPalette: (mode: "files" | "commands") => void;
  closePalette: () => void;
```

- [ ] **Step 4: Add the implementation.**

In `store.ts`, right after the `bumpFsVersion` implementation:

```ts
  palette: null,
  openPalette: (mode) => set({ palette: { mode } }),
  closePalette: () => set({ palette: null }),
```

- [ ] **Step 5: Wire the menu actions.**

In `packages/app/src/renderer/src/lib/useMenuActions.ts`, add two cases to the
`switch (a.type)` (alongside the others):

```ts
        case "quick-open": {
          s.openPalette("files");
          break;
        }
        case "command-palette": {
          s.openPalette("commands");
          break;
        }
```

- [ ] **Step 6: Run tests + typecheck.**

Run: `npx vitest run packages/app/src/renderer/src/store.palette.test.ts` -> PASS.
Run: `npm run typecheck` -> clean (the `MenuAction` union from Task 3 makes the new `switch` cases type-check and keeps the switch exhaustive).

- [ ] **Step 7: Lint + commit.**

```bash
npx biome check --write packages/app/src/renderer/src/store.ts packages/app/src/renderer/src/store.palette.test.ts packages/app/src/renderer/src/lib/useMenuActions.ts
git add packages/app/src/renderer/src/store.ts packages/app/src/renderer/src/store.palette.test.ts packages/app/src/renderer/src/lib/useMenuActions.ts
git commit -m "feat(palette): store palette state + open on Cmd+P / Cmd+Shift+P"
```

---

## Task 5: command registry

**Files:**
- Create: `packages/app/src/renderer/src/lib/commands.ts`
- Test: `packages/app/src/renderer/src/lib/commands.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `packages/app/src/renderer/src/lib/commands.test.ts`:

```ts
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildCommands } from "./commands";
import { useApp } from "../store";

const initialState = useApp.getState();
let setSectionVisibility: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setSectionVisibility = vi.fn(() => Promise.resolve(undefined));
  (globalThis as { window?: unknown }).window = {
    airlock: { setSectionVisibility, workspaceClose: () => Promise.resolve() },
  };
  useApp.setState(initialState, true);
});
afterEach(() => useApp.setState(initialState, true));

it("includes core + per-section commands", () => {
  const cmds = buildCommands(useApp.getState(), () => {});
  const ids = cmds.map((c) => c.id);
  expect(ids).toContain("go-to-file");
  expect(ids).toContain("new-terminal");
  expect(ids).toContain("toggle-section-git");
});

it("Go to File runs the injected callback", () => {
  const goToFiles = vi.fn();
  const cmds = buildCommands(useApp.getState(), goToFiles);
  cmds.find((c) => c.id === "go-to-file")?.run();
  expect(goToFiles).toHaveBeenCalledOnce();
});

it("a section toggle flips that section via the IPC", () => {
  const cmds = buildCommands(useApp.getState(), () => {});
  // git defaults visible -> toggling asks to hide it.
  cmds.find((c) => c.id === "toggle-section-git")?.run();
  expect(setSectionVisibility).toHaveBeenCalledWith("git", false);
});

it("New Tab opens a blank tab", () => {
  const before = useApp.getState().tabs.length;
  buildCommands(useApp.getState(), () => {}).find((c) => c.id === "new-tab")?.run();
  expect(useApp.getState().tabs.length).toBe(before + 1);
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `npx vitest run packages/app/src/renderer/src/lib/commands.test.ts`
Expected: FAIL -- module `./commands` does not exist.

- [ ] **Step 3: Implement `commands.ts`.**

Create `packages/app/src/renderer/src/lib/commands.ts`:

```ts
import type { Section } from "../../../shared/ipc";
import type { AppState } from "../store";
import { closeEditorFile, openEditorFile } from "./editorFiles";
import { openPickedFolder } from "./openFolder";

export interface Command {
  id: string;
  title: string;
  run: () => void | Promise<void>;
}

const SECTIONS: { id: Section; label: string }[] = [
  { id: "files", label: "Files" },
  { id: "secrets", label: "Secrets" },
  { id: "git", label: "Git" },
  { id: "activity", label: "Activity" },
  { id: "databases", label: "Databases" },
  { id: "docker", label: "Docker" },
  { id: "host", label: "Host" },
  { id: "audit", label: "Audit" },
];

// Build the v1 command set from a live store snapshot. `goToFiles` switches the
// open palette to files mode (injected by the Palette so this stays UI-agnostic).
export function buildCommands(s: AppState, goToFiles: () => void): Command[] {
  const cmds: Command[] = [
    { id: "go-to-file", title: "Go to File", run: goToFiles },
    {
      id: "open-folder",
      title: "Open Folder...",
      run: async () => {
        const picked = await window.airlock.openFolder();
        if (picked) await openPickedFolder(picked);
      },
    },
    {
      id: "open-file",
      title: "Open File...",
      run: async () => {
        const rel = await window.airlock.openFile();
        if (rel) await openEditorFile(s.activeTabId, rel);
      },
    },
    { id: "new-tab", title: "New Tab", run: () => s.openBlankTab() },
    {
      id: "new-terminal",
      title: "New Terminal",
      run: () => {
        s.addTerminal(s.activeTabId);
      },
    },
    {
      id: "split-view",
      title: "Split View (New Terminal)",
      run: () => {
        const cur = s.current;
        if (!cur) {
          s.addTerminal(s.activeTabId);
          return;
        }
        s.splitItems(
          cur,
          { kind: "terminal", id: s.addTerminal(s.activeTabId) },
          s.activeTabId,
        );
      },
    },
    {
      id: "close-editor",
      title: "Close Editor",
      run: async () => {
        if (s.diff) s.setDiff(null);
        else if (s.settingsOpen) s.setSettingsOpen(false);
        else if (s.dbView) s.setDbView(null);
        else if (s.selectedFile)
          await closeEditorFile(s.activeTabId, s.selectedFile);
      },
    },
    {
      id: "close-folder",
      title: "Close Folder",
      run: async () => {
        await window.airlock.workspaceClose();
        s.setRoot(null);
      },
    },
    { id: "toggle-sidebar", title: "Toggle Sidebar", run: () => s.toggleSidebar() },
    {
      id: "move-sidebar",
      title: "Move Sidebar (Left/Right)",
      run: () => s.toggleSidebarPosition(),
    },
    {
      id: "theme-dark",
      title: "Switch Theme: Dark",
      run: () => {
        s.setTheme("dark");
        void window.airlock.prefsSet({ theme: "dark" });
      },
    },
    {
      id: "theme-light",
      title: "Switch Theme: Light",
      run: () => {
        s.setTheme("light");
        void window.airlock.prefsSet({ theme: "light" });
      },
    },
  ];
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
  return cmds;
}
```

- [ ] **Step 4: Run tests + typecheck.**

Run: `npx vitest run packages/app/src/renderer/src/lib/commands.test.ts` -> PASS.
Run: `npm run typecheck` -> clean.

- [ ] **Step 5: Lint + commit.**

```bash
npx biome check --write packages/app/src/renderer/src/lib/commands.ts packages/app/src/renderer/src/lib/commands.test.ts
git add packages/app/src/renderer/src/lib/commands.ts packages/app/src/renderer/src/lib/commands.test.ts
git commit -m "feat(palette): command registry (buildCommands)"
```

---

## Task 6: the Palette component (UI + cache + mount + CSS)

**Files:**
- Create: `packages/app/src/renderer/src/components/Palette.tsx`
- Modify: `packages/app/src/renderer/src/App.tsx`
- Modify: `packages/app/src/renderer/src/theme.css`
- Test: `packages/app/src/renderer/src/components/Palette.test.tsx`

- [ ] **Step 1: Write the failing test.**

Create `packages/app/src/renderer/src/components/Palette.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { Palette } from "./Palette";

// Spy openEditorFile so a file pick is observable without the full open flow.
const openEditorFile = vi.fn(() => Promise.resolve());
vi.mock("../lib/editorFiles", () => ({
  openEditorFile: (...a: unknown[]) => openEditorFile(...a),
  closeEditorFile: () => Promise.resolve(),
}));

const initialState = useApp.getState();
const ROOT = "/workspace";

beforeEach(() => {
  openEditorFile.mockClear();
  window.airlock = new Proxy(
    { listAllFiles: () => Promise.resolve({ files: ["a.ts", "src/b.ts"], truncated: false }) },
    { get: (t, p) => (p in t ? (t as Record<string, unknown>)[p as string] : () => Promise.resolve(undefined)) },
  ) as unknown as typeof window.airlock;
  useApp.setState(initialState, true);
  // Seed the active tab's root so files mode has a project.
  const tabId = useApp.getState().activeTabId;
  const cur = useApp.getState().tabState[tabId];
  if (cur) useApp.setState({ tabState: { ...useApp.getState().tabState, [tabId]: { ...cur, root: ROOT } } });
});
afterEach(() => cleanup());

it("files mode: type then Enter opens the matched file and closes", async () => {
  useApp.getState().openPalette("files");
  const { container, getByPlaceholderText } = render(<Palette />);
  const input = getByPlaceholderText(/go to file/i) as HTMLInputElement;
  await waitFor(() => expect(container.querySelectorAll(".palette-row").length).toBeGreaterThan(0));
  fireEvent.change(input, { target: { value: "b.ts" } });
  await waitFor(() => expect(container.textContent).toContain("src/b.ts"));
  fireEvent.keyDown(input, { key: "Enter" });
  expect(openEditorFile).toHaveBeenCalledWith(useApp.getState().activeTabId, "src/b.ts");
  expect(useApp.getState().palette).toBeNull();
});

it("'>' switches to commands mode and runs a command", () => {
  useApp.getState().openPalette("files");
  const { getByPlaceholderText } = render(<Palette />);
  const input = getByPlaceholderText(/go to file/i) as HTMLInputElement;
  fireEvent.change(input, { target: { value: ">new tab" } });
  const before = useApp.getState().tabs.length;
  fireEvent.keyDown(input, { key: "Enter" });
  expect(useApp.getState().tabs.length).toBe(before + 1);
  expect(useApp.getState().palette).toBeNull();
});

it("Escape closes", () => {
  useApp.getState().openPalette("commands");
  const { getByPlaceholderText } = render(<Palette />);
  fireEvent.keyDown(getByPlaceholderText(/run a command/i), { key: "Escape" });
  expect(useApp.getState().palette).toBeNull();
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `npx vitest run packages/app/src/renderer/src/components/Palette.test.tsx`
Expected: FAIL -- module `./Palette` does not exist.

- [ ] **Step 3: Implement `Palette.tsx`.**

Create `packages/app/src/renderer/src/components/Palette.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { type Command, buildCommands } from "../lib/commands";
import { type FuzzyMatch, fuzzyFilter } from "../lib/fuzzy";
import { openEditorFile } from "../lib/editorFiles";
import { useApp } from "../store";

// File list cache keyed by `${root} ${fsVersion}`, so a watcher bump
// invalidates it transparently. Module-level: survives palette reopen.
const fileCache = new Map<string, { files: string[]; truncated: boolean }>();

// Render `text` with matched indices bolded.
function Highlight({ text, indices }: { text: string; indices: number[] }) {
  const set = new Set(indices);
  return (
    <>
      {[...text].map((ch, i) =>
        set.has(i) ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: char positions are stable for a fixed string
          <b key={i}>{ch}</b>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: char positions are stable for a fixed string
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}

type Row =
  | { kind: "file"; path: string; match: FuzzyMatch }
  | { kind: "command"; cmd: Command; match: FuzzyMatch };

export function Palette() {
  const palette = useApp((s) => s.palette);
  if (!palette) return null;
  // Remount per open (key by mode) so query/selection reset each time.
  return <PaletteInner key={palette.mode} mode={palette.mode} />;
}

function PaletteInner({ mode }: { mode: "files" | "commands" }) {
  const closePalette = useApp((s) => s.closePalette);
  const openPalette = useApp((s) => s.openPalette);
  const activeTabId = useApp((s) => s.activeTabId);
  const root = useApp((s) => s.tabState[activeTabId]?.root ?? null);
  const fsVersion = useApp((s) => (root ? (s.fsVersion[root] ?? 0) : 0));

  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<{ files: string[]; truncated: boolean }>({
    files: [],
    truncated: false,
  });
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // commands mode = opened that way OR a leading ">" in files mode.
  const commandsMode = mode === "commands" || query.startsWith(">");
  const q = commandsMode ? query.replace(/^>/, "").trimStart() : query;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Load + cache the project's file list when in files mode.
  useEffect(() => {
    if (commandsMode || !root) return;
    const cacheKey = `${root} ${fsVersion}`;
    const cached = fileCache.get(cacheKey);
    if (cached) {
      setFiles(cached);
      return;
    }
    let cancelled = false;
    window.airlock
      .listAllFiles(root)
      .then((r) => {
        if (cancelled) return;
        fileCache.set(cacheKey, r);
        setFiles(r);
        if (r.truncated)
          console.warn(`[palette] file list truncated at ${r.files.length}`);
      })
      .catch((err) => console.error("listAllFiles failed", err));
    return () => {
      cancelled = true;
    };
  }, [commandsMode, root, fsVersion]);

  const results: Row[] = useMemo(() => {
    if (commandsMode) {
      const cmds = buildCommands(useApp.getState(), () => openPalette("files"));
      return fuzzyFilter(q, cmds, (c) => c.title).map(({ item, match }) => ({
        kind: "command",
        cmd: item,
        match,
      }));
    }
    return fuzzyFilter(q, files.files, (f) => f).map(({ item, match }) => ({
      kind: "file",
      path: item,
      match,
    }));
  }, [commandsMode, q, files, openPalette]);

  const clamped = results.length ? Math.min(sel, results.length - 1) : 0;

  const run = (i: number) => {
    const r = results[i];
    closePalette(); // always close, even if the action throws
    if (!r) return;
    try {
      const p =
        r.kind === "command"
          ? r.cmd.run()
          : openEditorFile(activeTabId, r.path);
      if (p) p.catch((err) => console.error("palette action failed", err));
    } catch (err) {
      console.error("palette action failed", err);
    }
  };

  return (
    <>
      <button
        type="button"
        className="palette-backdrop"
        aria-label="Close palette"
        onClick={closePalette}
      />
      <div className="palette" role="dialog" aria-modal="true">
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          placeholder={commandsMode ? "Run a command..." : "Go to file..."}
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => (results.length ? (s + 1) % results.length : 0));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) =>
                results.length ? (s - 1 + results.length) % results.length : 0,
              );
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(clamped);
            } else if (e.key === "Escape") {
              e.preventDefault();
              closePalette();
            }
          }}
        />
        <div className="palette-list">
          {results.map((r, i) => (
            <button
              type="button"
              key={r.kind === "file" ? `f:${r.path}` : `c:${r.cmd.id}`}
              className={`palette-row${i === clamped ? " selected" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => run(i)}
            >
              {r.kind === "file" ? (
                <Highlight text={r.path} indices={r.match.indices} />
              ) : (
                <Highlight text={r.cmd.title} indices={r.match.indices} />
              )}
            </button>
          ))}
          {results.length === 0 && (
            <div className="palette-empty">No results</div>
          )}
        </div>
        {!commandsMode && files.truncated && (
          <div className="palette-foot">
            showing first {files.files.length} files
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Mount it in `App.tsx`.**

Add the import near the other component imports:

```ts
import { Palette } from "./components/Palette";
```

And render it inside `app-shell`, right after the `{modal === "connect-render" && <RenderConnectModal />}` line:

```tsx
        <Palette />
```

(`<Palette />` self-gates on `s.palette`, returning null when closed.)

- [ ] **Step 5: Add the CSS.**

In `packages/app/src/renderer/src/theme.css`, append:

```css
/* Command / quick-open palette */
.palette-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  border: none;
  padding: 0;
  z-index: 50;
}
.palette {
  position: fixed;
  top: 12%;
  left: 50%;
  transform: translateX(-50%);
  width: min(640px, 90vw);
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  z-index: 51;
  overflow: hidden;
}
.palette-input {
  padding: 10px 12px;
  font-size: 14px;
  background: transparent;
  color: var(--fg);
  border: none;
  border-bottom: 1px solid var(--border, #333);
  outline: none;
}
.palette-list {
  overflow-y: auto;
}
.palette-row {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 12px;
  font-size: 13px;
  color: var(--fg);
  background: transparent;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.palette-row.selected {
  background: var(--selected);
}
.palette-row b {
  color: var(--accent, #4a9eff);
  font-weight: 600;
}
.palette-empty,
.palette-foot {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--fg-dim);
}
.palette-foot {
  border-top: 1px solid var(--border, #333);
}
```

- [ ] **Step 6: Run the test + the whole component/lib suite + typecheck.**

Run: `npx vitest run packages/app/src/renderer/src/components/Palette.test.tsx` -> PASS.
Run: `npx vitest run packages/app/src/renderer/src/components/ packages/app/src/renderer/src/lib/` -> all PASS (no regressions).
Run: `npm run typecheck` -> clean.

- [ ] **Step 7: Lint + commit.**

```bash
npx biome check --write packages/app/src/renderer/src/components/Palette.tsx packages/app/src/renderer/src/components/Palette.test.tsx packages/app/src/renderer/src/App.tsx packages/app/src/renderer/src/theme.css
git add packages/app/src/renderer/src/components/Palette.tsx packages/app/src/renderer/src/components/Palette.test.tsx packages/app/src/renderer/src/App.tsx packages/app/src/renderer/src/theme.css
git commit -m "feat(palette): the command/quick-open palette modal (Cmd+P / Cmd+Shift+P)"
```

---

## Final verification (after all tasks)

- [ ] `npx vitest run` -- all green.
- [ ] `npm run typecheck` -- clean.
- [ ] `npx biome check .` -- clean.
- [ ] `npm run package` -- build the macOS app for the owner to gate.

## Manual gate checklist (owner)

- Cmd+P opens the palette; typing fuzzy-matches files; Enter opens the file; Esc closes.
- Cmd+Shift+P opens in commands mode; typing `>` in Cmd+P mode also switches.
- Commands run: Toggle Sidebar, Switch Theme, New Terminal, Split View, Toggle <Section>.
- A huge repo still opens the palette quickly; `node_modules`/`.git` files never appear.
