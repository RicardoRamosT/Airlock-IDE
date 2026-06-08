# Project Search (Find-in-Files) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Search the contents of every file in the active project, show hits grouped by file in a window-level panel, and click a hit to open the file scrolled to that line.

**Architecture:** A zero-dep Node scan in `agent-core` (`searchProject`, reusing `listFilesRecursive` + `readWorkspaceFile`) behind an `fs:search` IPC. The UI is a window-level overlay (`<SearchPanel>` rendered in `App`, like the command palette) driven by top-level store state (`searchOpen`, `search`, `reveal`). Clicking a result calls `openEditorFile(tab, path, line)`, which sets a top-level `reveal` that `EditorPane` consumes to scroll CodeMirror to the line.

**Tech Stack:** Electron + electron-vite, React 19, Zustand, TypeScript (strict), CodeMirror, vitest, biome.

**Spec:** `docs/superpowers/specs/2026-06-07-project-search-design.md`

---

## Conventions for every task

- **ASCII-only** in `packages/agent-core/**`, `packages/app/src/main/**`,
  `packages/app/src/preload/**`, `packages/app/src/shared/ipc.ts` (CJS bundling;
  use `--`). Renderer `.tsx`/`.css`/`.ts` and this plan are exempt.
- Commands (repo root `/Users/ricardoramos/Projects/airlock`): one test file
  `npx vitest run <path>`; typecheck `npm run typecheck`; lint
  `npx biome check --write <paths>` then `npx biome check <paths>`.
- Branch: `feat/project-search` (already created). Do NOT push.

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `packages/agent-core/src/workspace/search.ts` (new) | `searchProject` Node scan | 1 |
| `packages/agent-core/src/index.ts` | export it | 1 |
| `packages/app/src/shared/ipc.ts` | search types + `searchProject` + `find-in-files` MenuAction | 2 |
| `packages/app/src/preload/index.ts` | wire `fs:search` | 2 |
| `packages/app/src/main/ipc.ts` | `fs:search` handler | 2 |
| `packages/app/src/main/menu.ts` | "Find in Files" Go entry (Cmd+Shift+F) | 2 |
| `packages/app/src/renderer/src/store.ts` | `searchOpen`/`search`/`reveal` + actions | 3 |
| `packages/app/src/renderer/src/lib/useMenuActions.ts` | open search on the menu action | 3 |
| `packages/app/src/renderer/src/lib/editorFiles.ts` | `openEditorFile(tab, rel, line?)` | 3 |
| `packages/app/src/renderer/src/components/SearchPanel.tsx` (new) | the search overlay | 4 |
| `packages/app/src/renderer/src/components/App.tsx` | mount `<SearchPanel>` | 4 |
| `packages/app/src/renderer/src/lib/commands.ts` | "Find in Files" command | 4 |
| `packages/app/src/renderer/src/theme.css` | search styles | 4 |
| `packages/app/src/renderer/src/components/EditorPane.tsx` | consume `reveal` -> scroll; `tabId` prop | 5 |
| `packages/app/src/renderer/src/components/ProjectPane.tsx` | pass `tabId` to `<EditorPane>` | 5 |

---

## Task 1: agent-core searchProject

**Files:**
- Create: `packages/agent-core/src/workspace/search.ts`
- Modify: `packages/agent-core/src/index.ts`
- Test: `packages/agent-core/src/workspace/search.test.ts` (new)

- [ ] **Step 1: Write the failing test.**

Create `packages/agent-core/src/workspace/search.test.ts`:

```ts
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { searchProject } from "./search";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "airlock-search-"));
  await mkdir(path.join(root, "src"));
  await mkdir(path.join(root, "node_modules"));
  await writeFile(path.join(root, "a.ts"), "const Hello = 1;\nconst x = 2;\n");
  await writeFile(path.join(root, "src", "b.ts"), "// hello world\n");
  await writeFile(path.join(root, "node_modules", "c.ts"), "hello skip\n");
  await writeFile(path.join(root, "blob.bin"), Buffer.from([0x68, 0x00, 0x69]));
});

describe("searchProject", () => {
  it("finds case-insensitive matches across files, with line/col/preview", async () => {
    const r = await searchProject(root, "hello");
    const byPath = Object.fromEntries(r.files.map((f) => [f.path, f]));
    expect(byPath["a.ts"].matches[0]).toEqual({
      line: 1,
      col: 6,
      preview: "const Hello = 1;",
    });
    expect(byPath["src/b.ts"].matches[0].line).toBe(1);
    // node_modules is pruned by listFilesRecursive's IGNORED set.
    expect(byPath["node_modules/c.ts"]).toBeUndefined();
    expect(r.truncated).toBe(false);
  });

  it("returns nothing for an empty query and skips binary files", async () => {
    expect(await searchProject(root, "  ")).toEqual({ files: [], truncated: false });
    const r = await searchProject(root, "hi");
    expect(r.files.some((f) => f.path === "blob.bin")).toBe(false);
  });

  it("flags truncation at maxResults", async () => {
    const r = await searchProject(root, "const", { maxResults: 1 });
    expect(r.truncated).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

Run: `npx vitest run packages/agent-core/src/workspace/search.test.ts`
Expected: FAIL -- module `./search` does not exist.

- [ ] **Step 3: Implement `search.ts`.**

```ts
import { type FileContent, readWorkspaceFile } from "./read";
import { listFilesRecursive } from "./tree";

export interface SearchMatch {
  line: number;
  col: number;
  preview: string;
}
export interface SearchFileResult {
  path: string;
  matches: SearchMatch[];
}
export interface SearchResults {
  files: SearchFileResult[];
  truncated: boolean;
}

const MAX_RESULTS = 1000;
const MAX_PER_FILE = 50;
const PREVIEW_LEN = 200;

// Zero-dep project text search: walk the file list (IGNORED dirs already pruned),
// read each text file (binaries skipped), and collect the first case-insensitive
// substring match per line. Capped by maxResults (total) and maxPerFile; either
// cap sets truncated so the UI can say "showing first N". ASCII-only file.
export async function searchProject(
  root: string,
  query: string,
  opts?: { maxResults?: number; maxPerFile?: number },
): Promise<SearchResults> {
  const q = query.toLowerCase();
  if (q.trim() === "") return { files: [], truncated: false };
  const maxResults = opts?.maxResults ?? MAX_RESULTS;
  const maxPerFile = opts?.maxPerFile ?? MAX_PER_FILE;

  const { files: paths } = await listFilesRecursive(root);
  const files: SearchFileResult[] = [];
  let total = 0;
  let truncated = false;

  for (const path of paths) {
    if (total >= maxResults) {
      truncated = true;
      break;
    }
    let fc: FileContent;
    try {
      fc = await readWorkspaceFile(root, path);
    } catch {
      continue; // unreadable -- skip
    }
    if (fc.binary || fc.content === "") continue;
    const matches: SearchMatch[] = [];
    const lines = fc.content.split("\n");
    for (let i = 0; i < lines.length && total < maxResults; i++) {
      const raw = lines[i] ?? "";
      const col = raw.toLowerCase().indexOf(q);
      if (col < 0) continue;
      if (matches.length >= maxPerFile) {
        truncated = true;
        break;
      }
      matches.push({ line: i + 1, col, preview: raw.slice(0, PREVIEW_LEN) });
      total += 1;
    }
    if (total >= maxResults) truncated = true;
    if (matches.length > 0) files.push({ path, matches });
  }
  return { files, truncated };
}
```

- [ ] **Step 4: Export it.**

In `packages/agent-core/src/index.ts`, add a new export block (near the other `./workspace/*` exports):

```ts
export {
  type SearchFileResult,
  type SearchMatch,
  type SearchResults,
  searchProject,
} from "./workspace/search";
```

- [ ] **Step 5: Run tests + typecheck + lint + commit.**

Run: `npx vitest run packages/agent-core/src/workspace/search.test.ts` -> PASS.
Run: `npm run typecheck` -> clean.
```bash
npx biome check --write packages/agent-core/src/workspace/search.ts packages/agent-core/src/workspace/search.test.ts packages/agent-core/src/index.ts
git add packages/agent-core/src/workspace/search.ts packages/agent-core/src/workspace/search.test.ts packages/agent-core/src/index.ts
git commit -m "feat(search): searchProject -- zero-dep project text scan"
```

---

## Task 2: IPC + Find-in-Files menu

**Files:**
- Modify: `packages/app/src/shared/ipc.ts`
- Modify: `packages/app/src/preload/index.ts`
- Modify: `packages/app/src/main/ipc.ts`
- Modify: `packages/app/src/main/menu.ts`

- [ ] **Step 1: Add search types + method + MenuAction (shared/ipc.ts).**

The search types live in `@airlock/agent-core`; re-export them and add the API
method. At the top of `shared/ipc.ts` there is an `import type { ... } from
"@airlock/agent-core"` block and a matching `export type { ... }` block -- add
`SearchResults` (and `SearchMatch`, `SearchFileResult`) to BOTH. Then in
`interface AirlockApi`, after `listAllFiles(...)`:

```ts
  // Search file contents across the project (find-in-files). Case-insensitive
  // substring; results grouped by file; capped (truncated flag).
  searchProject(root: string, query: string): Promise<SearchResults>;
```

And extend `MenuAction` with:

```ts
  | { type: "find-in-files" }
```

- [ ] **Step 2: Wire preload (preload/index.ts), after `listAllFiles`:**

```ts
  searchProject: (root, query) =>
    ipcRenderer.invoke("fs:search", root, query),
```

- [ ] **Step 3: Add the main handler (main/ipc.ts), after the `fs:listAll` handler.**

Add `searchProject` to the existing `@airlock/agent-core` import, then:

```ts
  ipcMain.handle("fs:search", (e, root: unknown, query: unknown) => {
    if (typeof query !== "string") throw new Error("Invalid payload");
    return searchProject(resolveRoot(e, root), query);
  });
```

- [ ] **Step 4: Add the menu entry (main/menu.ts).**

In the **Go** submenu (added for the palette), append after the "Command
Palette..." item:

```ts
        {
          label: "Find in Files...",
          accelerator: "CmdOrCtrl+Shift+F",
          click: () => pushMenuAction({ type: "find-in-files" }),
        },
```

- [ ] **Step 5: Verify + commit.**

Run: `npm run typecheck` -> clean (new AirlockApi method implemented in preload).
Run: `npx vitest run packages/app/src/main/menu.test.ts` -> PASS (helper-builder tests unaffected).
Confirm ASCII-only on the four files.
```bash
npx biome check --write packages/app/src/shared/ipc.ts packages/app/src/preload/index.ts packages/app/src/main/ipc.ts packages/app/src/main/menu.ts
git add packages/app/src/shared/ipc.ts packages/app/src/preload/index.ts packages/app/src/main/ipc.ts packages/app/src/main/menu.ts
git commit -m "feat(search): fs:search IPC + Find in Files menu (Cmd+Shift+F)"
```

---

## Task 3: store state + open/reveal wiring

**Files:**
- Modify: `packages/app/src/renderer/src/store.ts`
- Modify: `packages/app/src/renderer/src/lib/useMenuActions.ts`
- Modify: `packages/app/src/renderer/src/lib/editorFiles.ts`
- Test: `packages/app/src/renderer/src/store.search.test.ts` (new)

These are TOP-LEVEL store fields (like `palette`/`fsVersion`), NOT per-tab
`ProjectState` -- so no `mirrorOf`/`freshProjectState`/reset-site threading.

- [ ] **Step 1: Write the failing test.**

Create `packages/app/src/renderer/src/store.search.test.ts`:

```ts
import { afterEach, beforeEach, expect, it } from "vitest";
import { useApp } from "./store";

const initialState = useApp.getState();
beforeEach(() => useApp.setState(initialState, true));
afterEach(() => useApp.setState(initialState, true));

it("setSearchOpen toggles, setSearchResults stores query+results", () => {
  const s = useApp.getState();
  expect(s.searchOpen).toBe(false);
  s.setSearchOpen(true);
  expect(useApp.getState().searchOpen).toBe(true);
  const results = { files: [{ path: "a.ts", matches: [] }], truncated: false };
  s.setSearchResults("hello", results);
  expect(useApp.getState().search).toEqual({ query: "hello", results });
});

it("revealLine sets reveal with an incrementing nonce", () => {
  const s = useApp.getState();
  expect(s.reveal).toBeNull();
  s.revealLine("t1", "a.ts", 5);
  const first = useApp.getState().reveal;
  expect(first).toMatchObject({ tabId: "t1", path: "a.ts", line: 5 });
  s.revealLine("t1", "a.ts", 5);
  expect(useApp.getState().reveal?.nonce).toBe((first?.nonce ?? 0) + 1);
});
```

- [ ] **Step 2: Run to confirm failure.**

Run: `npx vitest run packages/app/src/renderer/src/store.search.test.ts`
Expected: FAIL -- `setSearchOpen`/`setSearchResults`/`revealLine` not functions.

- [ ] **Step 3: Add the interface members (store.ts).**

Add `SearchResults` to the `import type { ... } from "../../../shared/ipc"` in
`store.ts`. Then in the `AppState` interface, near `palette`/`fsVersion`:

```ts
  // Find-in-files (window-level, like the palette). searchOpen = panel visible;
  // search = the last query + its results (kept so reopening is instant).
  searchOpen: boolean;
  search: { query: string; results: SearchResults } | null;
  setSearchOpen: (v: boolean) => void;
  setSearchResults: (query: string, results: SearchResults) => void;
  // A one-shot "scroll the editor to this line" signal, keyed by tabId+path and
  // consumed by EditorPane. nonce makes repeated clicks on the same line retrigger.
  reveal: { tabId: string; path: string; line: number; nonce: number } | null;
  revealLine: (tabId: string, path: string, line: number) => void;
```

- [ ] **Step 4: Add the implementation (store.ts), near the `palette` impl.**

```ts
  searchOpen: false,
  search: null,
  setSearchOpen: (v) => set({ searchOpen: v }),
  setSearchResults: (query, results) => set({ search: { query, results } }),
  reveal: null,
  revealLine: (tabId, path, line) =>
    set((s) => ({
      reveal: { tabId, path, line, nonce: (s.reveal?.nonce ?? 0) + 1 },
    })),
```

- [ ] **Step 5: Wire the menu action (useMenuActions.ts).**

Add a case to the `switch (a.type)`:

```ts
        case "find-in-files": {
          s.setSearchOpen(true);
          break;
        }
```

- [ ] **Step 6: Extend `openEditorFile` with an optional line (editorFiles.ts).**

Change the signature + add the reveal call:

```ts
export async function openEditorFile(
  tabId: string,
  relPath: string,
  line?: number,
): Promise<void> {
  const root = useApp.getState().tabState[tabId]?.root;
  if (!root) return;
  try {
    const file = await window.airlock.readFile(root, relPath);
    useApp.getState().openFile(relPath, file, tabId);
    if (line !== undefined) useApp.getState().revealLine(tabId, relPath, line);
  } catch (err) {
    console.error("open file failed", err);
  }
}
```

- [ ] **Step 7: Run tests + typecheck + lint + commit.**

Run: `npx vitest run packages/app/src/renderer/src/store.search.test.ts packages/app/src/renderer/src/store.test.ts` -> PASS.
Run: `npm run typecheck` -> clean.
```bash
npx biome check --write packages/app/src/renderer/src/store.ts packages/app/src/renderer/src/store.search.test.ts packages/app/src/renderer/src/lib/useMenuActions.ts packages/app/src/renderer/src/lib/editorFiles.ts
git add packages/app/src/renderer/src/store.ts packages/app/src/renderer/src/store.search.test.ts packages/app/src/renderer/src/lib/useMenuActions.ts packages/app/src/renderer/src/lib/editorFiles.ts
git commit -m "feat(search): store searchOpen/search/reveal + open-at-line wiring"
```

---

## Task 4: SearchPanel + App mount + command + CSS

**Files:**
- Create: `packages/app/src/renderer/src/components/SearchPanel.tsx`
- Modify: `packages/app/src/renderer/src/components/App.tsx`
- Modify: `packages/app/src/renderer/src/lib/commands.ts`
- Modify: `packages/app/src/renderer/src/theme.css`
- Test: `packages/app/src/renderer/src/components/SearchPanel.test.tsx`

- [ ] **Step 1: Write the failing test.**

Create `packages/app/src/renderer/src/components/SearchPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "../store";
import { SearchPanel } from "./SearchPanel";

const openEditorFile = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("../lib/editorFiles", () => ({
  openEditorFile: (...a: unknown[]) => openEditorFile(...a),
  closeEditorFile: () => Promise.resolve(),
}));

const initialState = useApp.getState();
const ROOT = "/workspace";

beforeEach(() => {
  openEditorFile.mockClear();
  window.airlock = new Proxy(
    {
      searchProject: () =>
        Promise.resolve({
          files: [{ path: "src/b.ts", matches: [{ line: 3, col: 0, preview: "hello there" }] }],
          truncated: false,
        }),
    },
    {
      get: (t, p) =>
        p in t ? (t as Record<string, unknown>)[p as string] : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
  useApp.setState(initialState, true);
  const tabId = useApp.getState().activeTabId;
  const cur = useApp.getState().tabState[tabId];
  if (cur)
    useApp.setState({
      tabState: { ...useApp.getState().tabState, [tabId]: { ...cur, root: ROOT } },
      searchOpen: true,
    });
});
afterEach(() => cleanup());

it("Enter searches, click opens the file at the line and closes", async () => {
  const { getByPlaceholderText, container } = render(<SearchPanel />);
  const input = getByPlaceholderText(/search/i) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "hello" } });
  fireEvent.keyDown(input, { key: "Enter" });
  // The preview splits the match across a <b> + text node, so query the row by
  // class rather than by its (element-spanning) text.
  const row = await waitFor(() => {
    const el = container.querySelector(".search-row");
    if (!el) throw new Error("no row yet");
    return el as HTMLElement;
  });
  fireEvent.click(row);
  await waitFor(() =>
    expect(openEditorFile).toHaveBeenCalledWith(useApp.getState().activeTabId, "src/b.ts", 3),
  );
  expect(useApp.getState().searchOpen).toBe(false);
});

it("Escape closes the panel", () => {
  const { getByPlaceholderText } = render(<SearchPanel />);
  fireEvent.keyDown(getByPlaceholderText(/search/i), { key: "Escape" });
  expect(useApp.getState().searchOpen).toBe(false);
});
```

- [ ] **Step 2: Run to confirm failure.**

Run: `npx vitest run packages/app/src/renderer/src/components/SearchPanel.test.tsx`
Expected: FAIL -- module `./SearchPanel` does not exist.

- [ ] **Step 3: Implement `SearchPanel.tsx`.**

```tsx
import { useEffect, useRef, useState } from "react";
import { openEditorFile } from "../lib/editorFiles";
import { useApp } from "../store";

// Highlight the matched span [col, col+len) within a preview line.
function Preview({ text, col, len }: { text: string; col: number; len: number }) {
  if (col < 0 || col >= text.length)
    return <span className="search-preview">{text}</span>;
  return (
    <span className="search-preview">
      {text.slice(0, col)}
      <b>{text.slice(col, col + len)}</b>
      {text.slice(col + len)}
    </span>
  );
}

// Window-level find-in-files overlay (mounted in App, gated on searchOpen). Reads
// the active project, searches on Enter, persists query+results in the store so
// reopening is instant, and opens a result at its line.
export function SearchPanel() {
  const activeTabId = useApp((s) => s.activeTabId);
  const root = useApp((s) => s.tabState[activeTabId]?.root ?? null);
  const search = useApp((s) => s.search);
  const setSearchOpen = useApp((s) => s.setSearchOpen);
  const setSearchResults = useApp((s) => s.setSearchResults);
  const [query, setQuery] = useState(search?.query ?? "");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const run = async () => {
    const q = query.trim();
    if (!q || !root || busy) return;
    setBusy(true);
    try {
      const results = await window.airlock.searchProject(root, q);
      setSearchResults(q, results);
    } catch (err) {
      console.error("search failed", err);
      setSearchResults(q, { files: [], truncated: false });
    } finally {
      setBusy(false);
    }
  };

  const results = search?.results ?? null;
  const total = results?.files.reduce((n, f) => n + f.matches.length, 0) ?? 0;

  return (
    <>
      <button
        type="button"
        className="palette-backdrop"
        aria-label="Close search"
        onClick={() => setSearchOpen(false)}
      />
      <div className="search-panel" role="dialog" aria-modal="true">
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          placeholder="Search in files..."
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void run();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setSearchOpen(false);
            }
          }}
        />
        <div className="search-results">
          {busy && <div className="search-empty">searching…</div>}
          {!busy && results && total === 0 && (
            <div className="search-empty">No results</div>
          )}
          {!busy &&
            results?.files.map((f) => (
              <div key={f.path} className="search-file">
                <div className="search-file-head">
                  {f.path} <span className="search-count">{f.matches.length}</span>
                </div>
                {f.matches.map((m) => (
                  <button
                    type="button"
                    key={`${m.line}:${m.col}`}
                    className="search-row"
                    onClick={() => {
                      void openEditorFile(activeTabId, f.path, m.line);
                      setSearchOpen(false);
                    }}
                  >
                    <span className="search-line">{m.line}</span>
                    <Preview text={m.preview} col={m.col} len={query.trim().length} />
                  </button>
                ))}
              </div>
            ))}
          {results?.truncated && (
            <div className="search-foot">showing first {total} matches</div>
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Mount in `App.tsx`.**

Add the import (near the other component imports):

```ts
import { SearchPanel } from "./components/SearchPanel";
```

Read the flag and render it next to `<Palette />`:

```ts
  const searchOpen = useApp((s) => s.searchOpen);
```

```tsx
        <Palette />
        {searchOpen && <SearchPanel />}
```

- [ ] **Step 5: Add the command (commands.ts).**

In `buildCommands`, add to the `cmds` array (near "Go to File"):

```ts
    { id: "find-in-files", title: "Find in Files", run: () => s.setSearchOpen(true) },
```

- [ ] **Step 6: Add CSS (theme.css), appended at the end.**

```css
/* Find-in-files panel (window-level overlay; reuses .palette-backdrop). */
.search-panel {
  position: fixed;
  top: 8%;
  left: 50%;
  transform: translateX(-50%);
  width: min(760px, 92vw);
  max-height: 76vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  z-index: 51;
  overflow: hidden;
}
.search-results {
  overflow-y: auto;
}
.search-file {
  padding: 4px 0;
}
.search-file-head {
  padding: 4px 12px;
  font-size: 12px;
  color: var(--fg-dim);
  position: sticky;
  top: 0;
  background: var(--bg-panel);
}
.search-count {
  opacity: 0.7;
}
.search-row {
  display: flex;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 3px 12px 3px 24px;
  font-size: 13px;
  color: var(--fg);
  background: transparent;
  border: none;
  cursor: pointer;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
}
.search-row:hover {
  background: var(--selected);
}
.search-line {
  color: var(--fg-dim);
  min-width: 36px;
  text-align: right;
}
.search-preview b {
  color: var(--accent);
}
.search-empty,
.search-foot {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--fg-dim);
}
```

- [ ] **Step 7: Run the test + the components dir + typecheck + lint + commit.**

Run: `npx vitest run packages/app/src/renderer/src/components/SearchPanel.test.tsx` -> PASS.
Run: `npx vitest run packages/app/src/renderer/src/components/` -> all PASS.
Run: `npm run typecheck` -> clean.
```bash
npx biome check --write packages/app/src/renderer/src/components/SearchPanel.tsx packages/app/src/renderer/src/components/SearchPanel.test.tsx packages/app/src/renderer/src/components/App.tsx packages/app/src/renderer/src/lib/commands.ts packages/app/src/renderer/src/theme.css
git add packages/app/src/renderer/src/components/SearchPanel.tsx packages/app/src/renderer/src/components/SearchPanel.test.tsx packages/app/src/renderer/src/components/App.tsx packages/app/src/renderer/src/lib/commands.ts packages/app/src/renderer/src/theme.css
git commit -m "feat(search): SearchPanel overlay + App mount + Find in Files command"
```

---

## Task 5: EditorPane line reveal

**Files:**
- Modify: `packages/app/src/renderer/src/components/EditorPane.tsx`
- Modify: `packages/app/src/renderer/src/components/ProjectPane.tsx`

CodeMirror scrolling is not reliably testable in jsdom, so this task is verified
by typecheck + the full suite (no regressions) + manual gating.

- [ ] **Step 1: Add a `tabId` prop + view ref + reveal effect (EditorPane.tsx).**

Add `useApp` to imports: `import { useApp } from "../store";`. Add `tabId: string`
to the props type. Inside the component, before the main editor `useEffect`, add a
ref and the reveal subscription:

```ts
  const viewRef = useRef<EditorView | null>(null);
  const reveal = useApp((s) => s.reveal);
```

In the main editor `useEffect`, after `const view = new EditorView({...})`, store
the ref, and null it in the cleanup:

```ts
    viewRef.current = view;
```
```ts
    return () => {
      flush();
      view.destroy();
      viewRef.current = null;
    };
```

After the main effect, add a reveal effect:

```ts
  // Scroll/select to a requested line when search (or any caller) reveals this
  // file in this pane. nonce in the deps makes repeated reveals of the same line
  // retrigger. Clamped to the document.
  useEffect(() => {
    if (!reveal || reveal.tabId !== tabId || reveal.path !== relPath) return;
    const view = viewRef.current;
    if (!view) return;
    const lineNo = Math.max(1, Math.min(reveal.line, view.state.doc.lines));
    const pos = view.state.doc.line(lineNo).from;
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
  }, [reveal, tabId, relPath]);
```

- [ ] **Step 2: Pass `tabId` to `<EditorPane>` (ProjectPane.tsx).**

In `editorArea`, add the prop (the `tabId` is the ProjectPane's prop, in scope):

```tsx
        <EditorPane
          key={relPath}
          tabId={tabId}
          root={root}
          relPath={relPath}
          file={content}
          theme={theme}
        />
```

- [ ] **Step 3: Verify + commit.**

Run: `npm run typecheck` -> clean.
Run: `npx vitest run` -> all PASS (no regressions; existing EditorPane usage now
passes `tabId`).
```bash
npx biome check --write packages/app/src/renderer/src/components/EditorPane.tsx packages/app/src/renderer/src/components/ProjectPane.tsx
git add packages/app/src/renderer/src/components/EditorPane.tsx packages/app/src/renderer/src/components/ProjectPane.tsx
git commit -m "feat(search): EditorPane scrolls to the revealed line"
```

---

## Final verification (after all tasks)

- [ ] `npx vitest run` -- all green.
- [ ] `npm run typecheck` -- clean.
- [ ] `npx biome check .` -- clean.
- [ ] `npm run package` -- build for the owner to gate.

## Manual gate checklist (owner)

- Cmd+Shift+F opens the search panel; type a word + Enter -> matches grouped by file.
- Click a match -> the file opens scrolled to that line; the panel closes.
- Reopen Cmd+Shift+F -> the last query + results are still there.
- `node_modules`/`.git` never appear; a binary file is never matched.
- A query with thousands of hits shows "showing first N matches" and stays responsive.
- "Find in Files" also works from the command palette (Cmd+Shift+P).
