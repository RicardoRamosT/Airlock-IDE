# File Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add create / rename / delete-to-Trash / duplicate to AirLock's FileTree, with the tree staying live as the user, the agent's terminal, and git all change files.

**Architecture:** Pure path-confined file ops live in `agent-core` (electron-free, unit-tested) next to `writeWorkspaceFile`. The main process wires IPC, does Trash via Electron `shell.trashItem`, and runs a per-window/per-root `chokidar` watcher that emits `fs:changed` — the single source of tree freshness. The renderer adds a FileTree context menu + inline editing, re-lists on `fs:changed` via a `fsVersion` store slice, and rewrites/closes open editor tabs when their file is renamed or deleted.

**Tech Stack:** Electron + React 19 + Zustand + TypeScript (strict, `noUncheckedIndexedAccess`); `chokidar` (new dep) for watching; Electron `shell.trashItem`; vitest.

**Conventions you MUST follow:**
- **ASCII-only** in `packages/agent-core/**`, `packages/app/src/main/**`, `packages/app/src/preload/**`, `packages/app/src/shared/ipc.ts` — these are bundled into Electron's CJS main and a multibyte char crashes `cjs_lexer`. Use `--`, not em-dashes; no curly quotes. Renderer `.tsx`/`.css` are exempt.
- Per-project IPC handlers resolve their pane root with `resolveRoot(e, root)` and validate payload types (`if (typeof relPath !== "string") throw new Error("Invalid payload")`).
- Gate after each task batch: `npm run typecheck`, `npm test`, `npm run lint` (auto-fix with `npx biome check --write <files>`). Commit per task. Do NOT push.

---

## File Structure

- Create `packages/agent-core/src/workspace/fileOps.ts` — `createFile`, `createDir`, `move`, `duplicate` (path-confined, no Electron).
- Create `packages/agent-core/src/workspace/fileOps.test.ts` — unit tests.
- Modify `packages/app/src/main/ipc.ts` — add `fs:create`, `fs:mkdir`, `fs:move`, `fs:duplicate`, `fs:trash` handlers + `.airlock` guard.
- Create `packages/app/src/main/fsWatch.ts` — chokidar watcher manager (per window+root), emits `fs:changed`.
- Modify `packages/app/src/main/window.ts` — dispose a window's watchers on close.
- Modify `packages/app/src/shared/ipc.ts` — `AirlockApi` fs methods + `onFsChanged` + `FsChangedEvent`.
- Modify `packages/app/src/preload/index.ts` — expose the fs methods + `onFsChanged`.
- Modify `packages/app/src/renderer/src/store.ts` — `fsVersion` slice + `bumpFsVersion`, and `renameFilePath` scene-sync action.
- Create `packages/app/src/renderer/src/lib/useFsWatch.ts` — subscribe to `onFsChanged`, bump `fsVersion`.
- Modify `packages/app/src/renderer/src/components/FileTree.tsx` — re-list on `fsVersion`, context menu, inline editing.
- Modify `packages/app/src/renderer/src/App.tsx` — mount `useFsWatch` once.
- Modify `packages/app/src/renderer/src/theme.css` — styles for the inline input (reuse existing `context-menu`/`menu-item`).

---

## Task 1: Path-confined file ops in agent-core

**Files:**
- Create: `packages/agent-core/src/workspace/fileOps.ts`
- Test: `packages/agent-core/src/workspace/fileOps.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/agent-core/src/workspace/fileOps.test.ts
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createDir, createFile, duplicate, move } from "./fileOps";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "airlock-fileops-"));
});

describe("createFile", () => {
  it("creates an empty file", async () => {
    await createFile(root, "a.ts");
    expect(readFileSync(path.join(root, "a.ts"), "utf8")).toBe("");
  });
  it("rejects when the file already exists", async () => {
    writeFileSync(path.join(root, "a.ts"), "x");
    await expect(createFile(root, "a.ts")).rejects.toThrow(/exists/i);
  });
  it("rejects a path escaping the root", async () => {
    await expect(createFile(root, "../evil.ts")).rejects.toThrow(/escape/i);
  });
});

describe("createDir", () => {
  it("creates a directory", async () => {
    await createDir(root, "src");
    expect(existsSync(path.join(root, "src"))).toBe(true);
  });
  it("rejects when it already exists", async () => {
    mkdirSync(path.join(root, "src"));
    await expect(createDir(root, "src")).rejects.toThrow(/exists/i);
  });
});

describe("move", () => {
  it("renames a file", async () => {
    writeFileSync(path.join(root, "a.ts"), "x");
    await move(root, "a.ts", "b.ts");
    expect(existsSync(path.join(root, "a.ts"))).toBe(false);
    expect(readFileSync(path.join(root, "b.ts"), "utf8")).toBe("x");
  });
  it("moves a file into a subdir", async () => {
    writeFileSync(path.join(root, "a.ts"), "x");
    mkdirSync(path.join(root, "src"));
    await move(root, "a.ts", "src/a.ts");
    expect(readFileSync(path.join(root, "src/a.ts"), "utf8")).toBe("x");
  });
  it("rejects when the destination exists", async () => {
    writeFileSync(path.join(root, "a.ts"), "x");
    writeFileSync(path.join(root, "b.ts"), "y");
    await expect(move(root, "a.ts", "b.ts")).rejects.toThrow(/exists/i);
  });
});

describe("duplicate", () => {
  it("duplicates a file to 'name copy.ext' and returns the new relPath", async () => {
    writeFileSync(path.join(root, "report.ts"), "x");
    const out = await duplicate(root, "report.ts");
    expect(out).toBe("report copy.ts");
    expect(readFileSync(path.join(root, "report copy.ts"), "utf8")).toBe("x");
  });
  it("increments when a copy already exists", async () => {
    writeFileSync(path.join(root, "report.ts"), "x");
    writeFileSync(path.join(root, "report copy.ts"), "x");
    const out = await duplicate(root, "report.ts");
    expect(out).toBe("report copy 2.ts");
  });
  it("duplicates a directory recursively to 'name copy'", async () => {
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src/a.ts"), "x");
    const out = await duplicate(root, "src");
    expect(out).toBe("src copy");
    expect(readFileSync(path.join(root, "src copy/a.ts"), "utf8")).toBe("x");
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run packages/agent-core/src/workspace/fileOps.test.ts`
Expected: FAIL — `Cannot find module './fileOps'`.

- [ ] **Step 3: Implement `fileOps.ts`**

```ts
// packages/agent-core/src/workspace/fileOps.ts
import { access, cp, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithin } from "./tree";

// All ops are path-confined: resolveWithin throws if relPath escapes root.
// ASCII-only file (bundled into the Electron CJS main).

async function exists(abs: string): Promise<boolean> {
  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}

// Create an empty file. Fails if it exists; the parent dir must already exist.
export async function createFile(root: string, relPath: string): Promise<void> {
  const abs = await resolveWithin(root, relPath);
  if (await exists(abs)) throw new Error(`Already exists: ${relPath}`);
  await writeFile(abs, "", { encoding: "utf8", flag: "wx" });
}

// Create a directory. Fails if it exists.
export async function createDir(root: string, relPath: string): Promise<void> {
  const abs = await resolveWithin(root, relPath);
  if (await exists(abs)) throw new Error(`Already exists: ${relPath}`);
  await mkdir(abs);
}

// Rename or move (file or dir). Fails if the destination exists.
export async function move(
  root: string,
  fromRel: string,
  toRel: string,
): Promise<void> {
  const fromAbs = await resolveWithin(root, fromRel);
  const toAbs = await resolveWithin(root, toRel);
  if (await exists(toAbs)) throw new Error(`Already exists: ${toRel}`);
  await rename(fromAbs, toAbs);
}

// Copy a file or dir to "<name> copy<.ext>", incrementing until free. Returns
// the new relPath (so the caller can reveal/select it).
export async function duplicate(
  root: string,
  relPath: string,
): Promise<string> {
  const abs = await resolveWithin(root, relPath);
  const dir = path.dirname(relPath);
  const ext = path.extname(relPath);
  const base = path.basename(relPath, ext);
  const candidate = (n: number): string => {
    const suffix = n === 1 ? "copy" : `copy ${n}`;
    const name = `${base} ${suffix}${ext}`;
    return dir === "." ? name : path.join(dir, name);
  };
  let n = 1;
  let outRel = candidate(n);
  // resolveWithin handles non-existent paths; use it to compute the abs target.
  while (await exists(await resolveWithin(root, outRel))) {
    n += 1;
    outRel = candidate(n);
  }
  await cp(abs, await resolveWithin(root, outRel), { recursive: true });
  return outRel;
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `npx vitest run packages/agent-core/src/workspace/fileOps.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/workspace/fileOps.ts packages/agent-core/src/workspace/fileOps.test.ts
git commit -m "feat(fileops): path-confined create/dir/move/duplicate in agent-core"
```

---

## Task 2: IPC handlers + preload + shared types

**Files:**
- Modify: `packages/app/src/shared/ipc.ts` (AirlockApi)
- Modify: `packages/app/src/main/ipc.ts` (handlers)
- Modify: `packages/app/src/preload/index.ts` (expose)

- [ ] **Step 1: Add the method signatures to `AirlockApi` in `shared/ipc.ts`** (right after the `writeFile` signature, ~line 234)

```ts
  // File management (USER actions; path-confined to the pane root). create/mkdir
  // fail if the target exists; move covers rename + the future drag-drop;
  // duplicate returns the new relPath; trash sends to the OS Trash (recoverable).
  // The .airlock vault dir is rejected by the handlers (defense in depth).
  createFile(root: string, relPath: string): Promise<void>;
  createDir(root: string, relPath: string): Promise<void>;
  moveFile(root: string, fromRel: string, toRel: string): Promise<void>;
  duplicateFile(root: string, relPath: string): Promise<string>;
  trashFile(root: string, relPath: string): Promise<void>;
```

- [ ] **Step 2: Add the handlers in `ipc.ts`** (right after the `fs:writeFile` handler, ~line 287). Import `shell` from electron at the top (`import { app, BrowserWindow, shell, ... } from "electron"`) and `createFile, createDir, move, duplicate` from agent-core (next to the existing `writeWorkspaceFile` import). Add the `.airlock` guard helper near the other module helpers (~line 155):

```ts
// Reject any path whose first segment is the .airlock vault dir (metadata; never
// mutated from the UI). Defense in depth -- the FileTree never shows .airlock.
function assertNotVault(relPath: string): void {
  const first = relPath.split(/[/\\]/)[0];
  if (first === ".airlock") throw new Error("The .airlock folder is protected");
}
```

```ts
  ipcMain.handle("fs:create", (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    return createFile(resolveRoot(e, root), relPath);
  });
  ipcMain.handle("fs:mkdir", (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    return createDir(resolveRoot(e, root), relPath);
  });
  ipcMain.handle(
    "fs:move",
    (e, root: unknown, fromRel: unknown, toRel: unknown) => {
      if (typeof fromRel !== "string" || typeof toRel !== "string")
        throw new Error("Invalid payload");
      assertNotVault(fromRel);
      assertNotVault(toRel);
      return move(resolveRoot(e, root), fromRel, toRel);
    },
  );
  ipcMain.handle("fs:duplicate", (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    return duplicate(resolveRoot(e, root), relPath);
  });
  ipcMain.handle("fs:trash", async (e, root: unknown, relPath: unknown) => {
    if (typeof relPath !== "string") throw new Error("Invalid payload");
    assertNotVault(relPath);
    // resolveWithin returns the absolute, root-confined path for shell.trashItem.
    const abs = await resolveWithin(resolveRoot(e, root), relPath);
    await shell.trashItem(abs);
  });
```

Note: import `resolveWithin` from agent-core alongside `createFile, createDir, move, duplicate`. It is exported from `workspace/tree.ts`; if the agent-core entrypoint (`packages/agent-core/src/index.ts`) does not already re-export it, add `export { resolveWithin } from "./workspace/tree";` (Task 2 Step 4 covers this).

- [ ] **Step 3: Expose in preload `index.ts`** (inside the `api` object)

```ts
  createFile: (root, relPath) => ipcRenderer.invoke("fs:create", root, relPath),
  createDir: (root, relPath) => ipcRenderer.invoke("fs:mkdir", root, relPath),
  moveFile: (root, fromRel, toRel) =>
    ipcRenderer.invoke("fs:move", root, fromRel, toRel),
  duplicateFile: (root, relPath) =>
    ipcRenderer.invoke("fs:duplicate", root, relPath),
  trashFile: (root, relPath) => ipcRenderer.invoke("fs:trash", root, relPath),
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS. (If `resolveWithin` is not exported from the agent-core entrypoint, add `export { resolveWithin } from "./workspace/tree";` to `packages/agent-core/src/index.ts` and re-run.)

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shared/ipc.ts packages/app/src/main/ipc.ts packages/app/src/preload/index.ts packages/agent-core/src/index.ts
git commit -m "feat(fs-ipc): create/mkdir/move/duplicate/trash handlers + .airlock guard"
```

---

## Task 3: Live chokidar watcher -> fs:changed

**Files:**
- Create: `packages/app/src/main/fsWatch.ts`
- Modify: `packages/app/src/main/ipc.ts` (call into the watcher when roots change)
- Modify: `packages/app/src/main/window.ts` (dispose on window close)
- Modify: `packages/app/src/shared/ipc.ts` (`FsChangedEvent` + `onFsChanged`)
- Modify: `packages/app/src/preload/index.ts` (`onFsChanged`)

- [ ] **Step 1: Add chokidar**

Run: `npm install chokidar --workspace packages/app`
Expected: `chokidar` added to `packages/app/package.json` dependencies.

- [ ] **Step 2: Write `fsWatch.ts`**

```ts
// packages/app/src/main/fsWatch.ts
import { type FSWatcher, watch } from "chokidar";
import type { WebContents } from "electron";

// One watcher per (window, root). Emits a debounced "fs:changed" {root} to the
// window so its FileTree re-lists. Single source of tree freshness: user ops,
// the agent's terminal mv/rm, and git all surface here. ASCII-only file.
const watchers = new Map<number, Map<string, FSWatcher>>();
const debounces = new Map<string, ReturnType<typeof setTimeout>>();

function ignored(p: string): boolean {
  return /(^|[/\\])(\.git|node_modules|\.airlock|dist|out|\.DS_Store)([/\\]|$)/.test(
    p,
  );
}

// Reconcile the set of watchers for one window to exactly `roots`.
export function syncWindowWatchers(wc: WebContents, roots: string[]): void {
  const id = wc.id;
  const current = watchers.get(id) ?? new Map<string, FSWatcher>();
  // Stop watchers for roots no longer open.
  for (const [root, w] of current) {
    if (!roots.includes(root)) {
      void w.close();
      current.delete(root);
    }
  }
  // Start watchers for newly opened roots.
  for (const root of roots) {
    if (current.has(root)) continue;
    const w = watch(root, {
      ignored,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    });
    const fire = () => {
      const key = `${id}:${root}`;
      clearTimeout(debounces.get(key));
      debounces.set(
        key,
        setTimeout(() => {
          if (!wc.isDestroyed()) wc.send("fs:changed", { root });
        }, 150),
      );
    };
    w.on("add", fire).on("addDir", fire).on("unlink", fire).on("unlinkDir", fire);
    current.set(root, w);
  }
  watchers.set(id, current);
}

// Dispose every watcher for a window (call on window close).
export function disposeWindowWatchers(id: number): void {
  const current = watchers.get(id);
  if (!current) return;
  for (const w of current.values()) void w.close();
  watchers.delete(id);
}
```

- [ ] **Step 3: Wire roots -> watchers in `ipc.ts`** — in the `workspace:roots` handler (~line 234), after `setWindowRoots(...)`, call `syncWindowWatchers(e.sender, roots.filter(...))`. Import `syncWindowWatchers` from `./fsWatch`.

```ts
  ipcMain.handle("workspace:roots", (e, roots: unknown) => {
    if (Array.isArray(roots)) {
      const list = roots.filter((r): r is string => typeof r === "string");
      setWindowRoots(e, list);
      syncWindowWatchers(e.sender, list);
    }
  });
```

- [ ] **Step 4: Dispose on window close in `window.ts`** — where the window `closed`/`close` handler already does `windowRoots.delete(win.id)` (~line 130), also call `disposeWindowWatchers(win.id)`. Import it from `./fsWatch`.

- [ ] **Step 5: Add `FsChangedEvent` + `onFsChanged` to `shared/ipc.ts`**

```ts
// Near the other event types:
export interface FsChangedEvent {
  root: string;
}
// In AirlockApi (near onAgentCommand):
  // The main-process chokidar watcher pushes this (debounced) whenever anything
  // changes under an open root -- user ops, the agent's terminal, git. The
  // FileTree re-lists. NO file contents cross; just the root that changed.
  onFsChanged(cb: (e: FsChangedEvent) => void): () => void;
```

- [ ] **Step 6: Expose in preload `index.ts`**

```ts
  onFsChanged: (cb) => subscribe<FsChangedEvent>("fs:changed", cb),
```

(Add `FsChangedEvent` to the type import from `../shared/ipc`.)

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm run lint`
Expected: PASS. (No unit test here — the watcher is exercised in the manual gate; vitest runs in node with no Electron WebContents.)

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/main/fsWatch.ts packages/app/src/main/ipc.ts packages/app/src/main/window.ts packages/app/src/shared/ipc.ts packages/app/src/preload/index.ts packages/app/package.json package-lock.json
git commit -m "feat(fs-watch): per-window chokidar watcher emits fs:changed"
```

---

## Task 4: Renderer freshness — fsVersion slice + useFsWatch + auto-relist

**Files:**
- Modify: `packages/app/src/renderer/src/store.ts`
- Create: `packages/app/src/renderer/src/lib/useFsWatch.ts`
- Modify: `packages/app/src/renderer/src/App.tsx`
- Modify: `packages/app/src/renderer/src/components/FileTree.tsx`

- [ ] **Step 1: Add `fsVersion` to the store** — in `AppState` add `fsVersion: Record<string, number>;` (app-global, NOT per-tab — keyed by root). Initialize `fsVersion: {}` in the initial state. Add the action declaration `bumpFsVersion: (root: string) => void;` and the impl:

```ts
  // Bump the freshness counter for a root so FileTrees on it re-list. Driven by
  // the main-process fs:changed watcher (see useFsWatch).
  bumpFsVersion: (root) =>
    set((s) => ({
      fsVersion: { ...s.fsVersion, [root]: (s.fsVersion[root] ?? 0) + 1 },
    })),
```

- [ ] **Step 2: Write `useFsWatch.ts`**

```ts
// packages/app/src/renderer/src/lib/useFsWatch.ts
import { useEffect } from "react";
import { useApp } from "../store";

// Subscribe once (per window) to the main-process fs:changed watcher and bump
// the per-root freshness counter so every FileTree on that root re-lists.
export function useFsWatch(): void {
  const bumpFsVersion = useApp((s) => s.bumpFsVersion);
  useEffect(
    () => window.airlock.onFsChanged((e) => bumpFsVersion(e.root)),
    [bumpFsVersion],
  );
}
```

- [ ] **Step 3: Mount it once in `App.tsx`** — call `useFsWatch();` near the top of the `App` component (alongside the other one-time hooks like `useAgentCommands()`).

- [ ] **Step 4: Re-list the tree on `fsVersion`** — in `FileTree.tsx`, read the version and add it to the effect deps so the tree refetches on change. In `FileTree`:

```ts
export function FileTree() {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const fsVersion = useApp((s) => (root ? (s.fsVersion[root] ?? 0) : 0));
  const [entries, setEntries] = useState<DirEntry[] | null>(null);

  useEffect(() => {
    if (!root) {
      setEntries(null);
      return;
    }
    window.airlock.listDir(root, ".").then(setEntries).catch(console.error);
  }, [root, fsVersion]);
  // ...unchanged render
}
```

And in `DirNode`, refetch the open dir's children when `fsVersion` changes (replace the one-shot load). Read `fsVersion` the same way and rewrite the load effect:

```ts
function DirNode({ name, relPath }: { name: string; relPath: string }) {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const fsVersion = useApp((s) => (root ? (s.fsVersion[root] ?? 0) : 0));
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);

  // Reload children whenever this dir is open and the tree changes.
  useEffect(() => {
    if (!open || !root) return;
    let cancelled = false;
    window.airlock
      .listDir(root, relPath)
      .then((c) => {
        if (!cancelled) setChildren(c);
      })
      .catch((err) => console.error("listDir failed", err));
    return () => {
      cancelled = true;
    };
  }, [open, root, relPath, fsVersion]);

  return (
    <div>
      <button
        type="button"
        className="tree-item dir"
        onClick={() => setOpen((o) => !o)}
      >
        <i className={`codicon codicon-chevron-${open ? "down" : "right"}`} />
        {name}
      </button>
      {open && children && (
        <div className="tree-children">
          {children.map((c) => (
            <Node key={c.name} entry={c} parent={relPath} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test && npm run lint`
Expected: PASS (existing tests unaffected; this adds no new test — freshness is gated manually, since it needs a real watcher).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer/src/store.ts packages/app/src/renderer/src/lib/useFsWatch.ts packages/app/src/renderer/src/App.tsx packages/app/src/renderer/src/components/FileTree.tsx
git commit -m "feat(filetree): re-list on the fs:changed watcher (live tree)"
```

---

## Task 5: Scene sync — rename rewrites open tabs; delete closes them

**Files:**
- Modify: `packages/app/src/renderer/src/store.ts`
- Test: `packages/app/src/renderer/src/store.test.ts`

- [ ] **Step 1: Write failing store tests** (add inside the existing `describe("editor tabs (unified main pane)")` block in `store.test.ts`)

```ts
  it("renameFilePath rewrites an open file across editorTabs/order/splits/current", () => {
    const id = tabIdAt(0);
    get().openFile("a.ts", FILE); // current = {file, a.ts}
    get().renameFilePath("a.ts", "b.ts");
    expect(get().tabState[id]?.editorTabs).toEqual(["b.ts"]);
    expect(get().tabState[id]?.current).toEqual({ kind: "file", path: "b.ts" });
    expect(get().tabState[id]?.selectedFile).toBe("b.ts");
    expect(
      get().tabState[id]?.mainTabOrder.some(
        (it) => it.kind === "file" && it.path === "b.ts",
      ),
    ).toBe(true);
  });

  it("renameFilePath rewrites a file that is a split member", () => {
    const id = tabIdAt(0);
    get().openFile("a.ts", FILE);
    get().splitItems({ kind: "file", path: "a.ts" }, { kind: "terminal", id: "t1" });
    get().renameFilePath("a.ts", "b.ts");
    expect(get().tabState[id]?.splits[0]?.[0]).toEqual({ kind: "file", path: "b.ts" });
  });

  it("renameFilePath rewrites nested files under a renamed folder", () => {
    const id = tabIdAt(0);
    get().openFile("src/a.ts", FILE);
    get().renameFilePath("src", "lib"); // folder rename
    expect(get().tabState[id]?.editorTabs).toEqual(["lib/a.ts"]);
    expect(get().tabState[id]?.current).toEqual({ kind: "file", path: "lib/a.ts" });
  });
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run packages/app/src/renderer/src/store.test.ts -t renameFilePath`
Expected: FAIL — `renameFilePath is not a function`.

- [ ] **Step 3: Implement `renameFilePath`** — declaration in `AppState`: `renameFilePath: (fromRel: string, toRel: string, tabId?: string) => void;` and the impl (place near `closeEditorTab`). It maps any file path equal to `fromRel` OR under `fromRel + "/"` to the rebased path, across `editorTabs`, `mainTabOrder`, `splits`, and `current`, then recomputes via `setView`.

```ts
  renameFilePath: (fromRel, toRel, tabId) =>
    set((s) => {
      const tid = tabId ?? s.activeTabId;
      const cur = s.tabState[tid];
      if (!cur) return {};
      // Rebase a file path: exact match -> toRel; under fromRel/ -> toRel + rest.
      const rebase = (p: string): string =>
        p === fromRel
          ? toRel
          : p.startsWith(`${fromRel}/`)
            ? toRel + p.slice(fromRel.length)
            : p;
      const mapItem = (it: PaneItem): PaneItem =>
        it.kind === "file" ? { kind: "file", path: rebase(it.path) } : it;
      const editorTabs = cur.editorTabs.map(rebase);
      const mainTabOrder = cur.mainTabOrder.map(mapItem);
      const splits = cur.splits.map(
        (pair) => [mapItem(pair[0]), mapItem(pair[1])] as [PaneItem, PaneItem],
      );
      const current = cur.current ? mapItem(cur.current) : null;
      return setView(s, tid, splits, current, { editorTabs, mainTabOrder });
    }),
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run packages/app/src/renderer/src/store.test.ts -t renameFilePath`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/renderer/src/store.ts packages/app/src/renderer/src/store.test.ts
git commit -m "feat(store): renameFilePath rewrites open tabs/splits on rename/move"
```

---

## Task 6: FileTree context menu + inline editing (the user-facing ops)

**Files:**
- Modify: `packages/app/src/renderer/src/components/FileTree.tsx`
- Modify: `packages/app/src/renderer/src/theme.css`
- Test: `packages/app/src/renderer/src/components/FileTree.menu.test.tsx` (new)

This task wires the menu + inline input to the IPC ops (Task 2) and the store sync (Task 5). The tree refreshes itself via the watcher (Task 4); the store sync keeps open editors consistent.

- [ ] **Step 1: Add the actions + menu state to `FileTree.tsx`.** Lift a small controller to the top-level `FileTree` (so it owns the context-menu + inline-edit state) and pass callbacks to nodes. Implement these handlers (each catches IPC errors into an inline message; after a successful op, the watcher refreshes the tree):

```ts
const root = useApp((s) => s.tabState[tabId]?.root ?? null);
const renameFilePath = useApp((s) => s.renameFilePath);

// parentRel: the folder to create in ("." for root). name: typed inline.
const doCreateFile = async (parentRel: string, name: string) => {
  if (!root) return;
  await window.airlock.createFile(root, join(parentRel, name));
};
const doCreateDir = async (parentRel: string, name: string) => {
  if (!root) return;
  await window.airlock.createDir(root, join(parentRel, name));
};
const doRename = async (relPath: string, newName: string) => {
  if (!root) return;
  const parent = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : ".";
  const toRel = join(parent, newName);
  await window.airlock.moveFile(root, relPath, toRel);
  renameFilePath(relPath, toRel, tabId); // keep open editors pointed at the new path
};
const doDuplicate = async (relPath: string) => {
  if (!root) return;
  await window.airlock.duplicateFile(root, relPath);
};
const doTrash = async (relPath: string, isDir: boolean, hasChildren: boolean) => {
  if (!root) return;
  if (isDir && hasChildren && !window.confirm(`Delete "${relPath}" and its contents?`)) return;
  await window.airlock.trashFile(root, relPath);
  // Close any open editor at/under the deleted path.
  for (const p of useApp.getState().tabState[tabId]?.editorTabs ?? []) {
    if (p === relPath || p.startsWith(`${relPath}/`)) useApp.getState().closeEditorTab(p, tabId);
  }
};
```

- [ ] **Step 2: Render the context menu** on right-click of a node (and the tree background for root-level new items), reusing the existing `context-menu` / `menu-item` / `popover-backdrop` classes (copy the structure from `MainTabs.tsx`). Items: New File, New Folder (both target the right-clicked dir, or the file's parent dir, or "." for background), Rename, Duplicate, Delete. Rename/Duplicate/Delete are omitted for the background menu.

- [ ] **Step 3: Inline input.** New File / New Folder / Rename set an "editing" state (`{ kind: "new-file" | "new-folder" | "rename"; parentRel; relPath? }`). Render an `<input>` in place (a new row for create, replacing the label for rename). Enter -> call the matching `do*`; Escape/blur -> cancel; on IPC reject, keep the input open and show the message (e.g. set an `error` state rendered under the input).

- [ ] **Step 4: Styles.** In `theme.css`, add `.tree-rename-input` mirroring `.terminal-tab-rename` (inherit font, transparent bg, full-row width) and a `.tree-error` (small red text). No new layout.

- [ ] **Step 5: Component test** (`FileTree.menu.test.tsx`, jsdom, mirroring `MainTabs.split.test.tsx`'s harness — stub `window.airlock` with a Proxy, seed the store tab root, render `<FileTree/>` inside the `ProjectPaneContext`).

```ts
// @vitest-environment jsdom
// Verifies: right-clicking a file shows Rename/Duplicate/Delete; committing the
// inline rename input calls moveFile with the new path.
```

Assert: after `fireEvent.contextMenu` on a file node, the menu shows "Rename"; choosing Rename + typing + Enter calls a `moveFile` spy with `(root, "a.ts", "b.ts")`.

- [ ] **Step 6: Verify + commit**

Run: `npm run typecheck && npm test && npm run lint` (auto-fix lint: `npx biome check --write packages/app/src/renderer/src/components/FileTree.tsx`)
Expected: PASS.

```bash
git add packages/app/src/renderer/src/components/FileTree.tsx packages/app/src/renderer/src/components/FileTree.menu.test.tsx packages/app/src/renderer/src/theme.css
git commit -m "feat(filetree): context menu + inline new/rename/delete/duplicate"
```

---

## Task 7: Full gate + package

- [ ] **Step 1:** `npm run typecheck` -> PASS.
- [ ] **Step 2:** `npm test` -> all PASS (re-run once to rule out flakiness).
- [ ] **Step 3:** `npm run lint` -> clean.
- [ ] **Step 4:** `npm run package` -> `packages/app/release/mac-arm64/AirLock.app` rebuilt.
- [ ] **Step 5:** Hand to the user to gate: create/rename/delete-to-Trash/duplicate from the right-click menu; confirm the tree updates live when the **agent's terminal** creates/removes a file (e.g. `touch x` in a pane); confirm an open editor follows a rename and closes on delete; confirm `.airlock` never appears and is rejected.

---

## Deferred (next): drag-and-drop move

The renderer-only follow-up: make `Node`/`DirNode` draggable + drop targets; on drop, call `window.airlock.moveFile(root, fromRel, toDirRel + "/" + basename)` and `renameFilePath(fromRel, newRel)`. No new IPC — it reuses `fs:move` and the watcher refresh from this plan.
