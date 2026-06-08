# Manual File Reordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user drag a file or folder to a custom position within its folder; the order persists to a committed `.airlock-order.json` and travels with the project. Folders never manually reordered keep the default sort.

**Architecture:** Ordering is a *view* concern. `listDirectory` keeps returning the default-sorted list; the renderer applies the saved order on top with a pure `applyOrder`. Persistence is a per-folder name list in `<root>/.airlock-order.json`, read/written path-confined in `agent-core`, surfaced over two IPC channels, cached in the Zustand store, and written through on drop. Drag handlers gain pointer-band detection (`dropZone`) so a folder's middle still means "move into" while any row's top/bottom edge reorders among siblings.

**Tech Stack:** Electron + electron-vite, React 19, Zustand, TypeScript (strict), vitest, biome.

**Spec:** `docs/superpowers/specs/2026-06-07-file-reordering-design.md`

---

## Conventions for every task

- **ASCII-only** in `packages/agent-core/**`, `packages/app/src/main/**`,
  `packages/app/src/preload/**`, and `packages/app/src/shared/ipc.ts` (these are
  bundled into the Electron CJS main; multibyte chars crash the cjs lexer). Use
  `--`, never em-dashes, in those files. Renderer `.tsx`/`.css`/`store.ts` and
  this plan are exempt.
- Commands: typecheck `npm run typecheck`; one test file `npx vitest run <path>`;
  full suite `npx vitest run`; lint `npx biome check .` (auto-fix:
  `npx biome check --write <paths>`).
- Branch: work on the current `feat/file-management` branch (this extends the
  same file-tree DnD subsystem). Do NOT push.

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `packages/agent-core/src/workspace/fileOrder.ts` (new) | Read/write `.airlock-order.json`, path-confined | 1 |
| `packages/agent-core/src/workspace/tree.ts` | Hide the order file from the tree (`IGNORED`) | 1 |
| `packages/agent-core/src/index.ts` | Re-export the new module | 1 |
| `packages/app/src/renderer/src/lib/fileOrder.ts` (new) | Pure `applyOrder` / `dropZone` / `reorderNames` | 2 |
| `packages/app/src/shared/ipc.ts` | `getFileOrder` / `setFileOrder` on `AirlockApi` | 3 |
| `packages/app/src/preload/index.ts` | Wire the two invokes | 3 |
| `packages/app/src/main/ipc.ts` | `fileOrder:get` / `fileOrder:set` handlers | 3 |
| `packages/app/src/main/fsWatch.ts` | Ignore the order file in the watcher | 3 |
| `packages/app/src/renderer/src/store.ts` | `fileOrder` state + `loadFileOrder` + `setFolderOrder` | 4 |
| `packages/app/src/renderer/src/components/FileTree.tsx` | Apply order on render (5), drag-to-reorder (6), Sort A-Z (7) | 5,6,7 |
| `packages/app/src/renderer/src/theme.css` | Insertion-line style | 6 |

---

## Task 1: agent-core order-file persistence

**Files:**
- Create: `packages/agent-core/src/workspace/fileOrder.ts`
- Modify: `packages/agent-core/src/workspace/tree.ts` (add `ORDER_FILE`, add it to `IGNORED`)
- Modify: `packages/agent-core/src/index.ts` (export block ~line 145-162)
- Test: `packages/agent-core/src/workspace/fileOrder.test.ts` (new), `packages/agent-core/src/workspace/tree.test.ts` (add one case)

- [ ] **Step 1: Add `ORDER_FILE` to `tree.ts` and hide it from listings.**

In `packages/agent-core/src/workspace/tree.ts`, add the export above `IGNORED` and include it in the set (keep the existing entries):

```ts
// The committed per-folder ordering file (see workspace/fileOrder.ts). Hidden
// from the tree like .DS_Store, but -- unlike .airlock -- NOT gitignored, so a
// project's custom order travels with it.
export const ORDER_FILE = ".airlock-order.json";

const IGNORED = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  ".airlock",
  ".DS_Store",
  ORDER_FILE,
]);
```

- [ ] **Step 2: Write the failing test for `fileOrder.ts`.**

Create `packages/agent-core/src/workspace/fileOrder.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ORDER_FILE } from "./tree";
import { readOrder, writeFolderOrder } from "./fileOrder";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "airlock-order-"));
});

describe("readOrder", () => {
  it("returns an empty map when the file is absent", async () => {
    expect(await readOrder(root)).toEqual({});
  });
  it("returns an empty map on malformed JSON", async () => {
    writeFileSync(path.join(root, ORDER_FILE), "{not json");
    expect(await readOrder(root)).toEqual({});
  });
  it("returns an empty map on an unrecognized version", async () => {
    writeFileSync(
      path.join(root, ORDER_FILE),
      JSON.stringify({ version: 999, order: { ".": ["a"] } }),
    );
    expect(await readOrder(root)).toEqual({});
  });
  it("drops malformed entries (non-array / non-string names)", async () => {
    writeFileSync(
      path.join(root, ORDER_FILE),
      JSON.stringify({ version: 1, order: { ".": ["a"], bad: 5, mix: [1] } }),
    );
    expect(await readOrder(root)).toEqual({ ".": ["a"] });
  });
});

describe("writeFolderOrder", () => {
  it("round-trips a folder's order and writes to the project root", async () => {
    await writeFolderOrder(root, "src", ["b.ts", "a.ts"]);
    expect(await readOrder(root)).toEqual({ src: ["b.ts", "a.ts"] });
    // The file lives at the root, not inside the folder.
    expect(readFileSync(path.join(root, ORDER_FILE), "utf8")).toContain("b.ts");
  });
  it("merges folders across writes", async () => {
    await writeFolderOrder(root, ".", ["x"]);
    await writeFolderOrder(root, "src", ["y"]);
    expect(await readOrder(root)).toEqual({ ".": ["x"], src: ["y"] });
  });
  it("an empty names array clears that folder's key", async () => {
    await writeFolderOrder(root, "src", ["a"]);
    await writeFolderOrder(root, "src", []);
    expect(await readOrder(root)).toEqual({});
  });
});
```

- [ ] **Step 3: Run the test to verify it fails.**

Run: `npx vitest run packages/agent-core/src/workspace/fileOrder.test.ts`
Expected: FAIL -- cannot resolve `./fileOrder` (module does not exist yet).

- [ ] **Step 4: Implement `fileOrder.ts`.**

Create `packages/agent-core/src/workspace/fileOrder.ts`:

```ts
import { readFile, rename, writeFile } from "node:fs/promises";
import { ORDER_FILE, resolveWithin } from "./tree";

// Per-folder custom file ordering, persisted to <root>/.airlock-order.json so it
// travels with the project. Keys are folder relpaths ("." = root); values are
// entry NAMES (basenames) in the user's chosen order. ASCII-only file (bundled
// into the Electron CJS main). The file is hidden from the tree (tree.ts
// IGNORED) and from the watcher (main/fsWatch.ts), so writing it never churns
// the UI.

const VERSION = 1;

// folderRel -> ordered entry names. A folder absent here uses the default sort.
export type OrderMap = Record<string, string[]>;

// Keep only well-formed entries: folderRel -> array of name strings.
function sanitize(raw: unknown): OrderMap {
  const out: OrderMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [folder, names] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (Array.isArray(names) && names.every((n) => typeof n === "string")) {
      out[folder] = names as string[];
    }
  }
  return out;
}

// Read the saved order map. A missing file, malformed JSON, or an unrecognized
// version all yield an empty map (-> default sort everywhere). Never throws.
export async function readOrder(root: string): Promise<OrderMap> {
  const abs = await resolveWithin(root, ORDER_FILE);
  let text: string;
  try {
    text = await readFile(abs, "utf8");
  } catch {
    return {};
  }
  try {
    const raw = JSON.parse(text) as { version?: unknown; order?: unknown };
    if (!raw || typeof raw !== "object" || raw.version !== VERSION) return {};
    return sanitize(raw.order);
  } catch {
    return {};
  }
}

// Set (or clear) one folder's order via read-modify-write. An empty names array
// deletes the folder's key (-> back to default sort). Writes atomically through
// a temp file + rename, mirroring main/prefs.ts.
export async function writeFolderOrder(
  root: string,
  folderRel: string,
  names: string[],
): Promise<void> {
  const map = await readOrder(root);
  if (names.length === 0) delete map[folderRel];
  else map[folderRel] = names;
  const abs = await resolveWithin(root, ORDER_FILE);
  const body = `${JSON.stringify({ version: VERSION, order: map }, null, 2)}\n`;
  const tmp = `${abs}.tmp`;
  await writeFile(tmp, body, { encoding: "utf8" });
  await rename(tmp, abs);
}
```

- [ ] **Step 5: Re-export from the package index.**

In `packages/agent-core/src/index.ts`, add to the export block (alphabetical-ish, near the other `workspace/*` exports):

```ts
export {
  type OrderMap,
  readOrder,
  writeFolderOrder,
} from "./workspace/fileOrder";
```

- [ ] **Step 6: Add the tree-hiding test case.**

In `packages/agent-core/src/workspace/tree.test.ts`, add a test that `listDirectory` hides the order file. Match the file's existing setup (it uses `mkdtempSync` + `listDirectory`; mirror whatever helper names are already there):

```ts
it("hides .airlock-order.json from listings", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "airlock-tree-order-"));
  writeFileSync(path.join(root, ".airlock-order.json"), "{}");
  writeFileSync(path.join(root, "a.ts"), "");
  const names = (await listDirectory(root, ".")).map((e) => e.name);
  expect(names).toEqual(["a.ts"]);
});
```

If `tree.test.ts` does not already import `mkdtempSync`/`writeFileSync`/`tmpdir`/`path`, add those imports.

- [ ] **Step 7: Run tests + typecheck to verify pass.**

Run: `npx vitest run packages/agent-core/src/workspace/fileOrder.test.ts packages/agent-core/src/workspace/tree.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Lint + commit.**

```bash
npx biome check --write packages/agent-core/src/workspace/fileOrder.ts packages/agent-core/src/workspace/fileOrder.test.ts packages/agent-core/src/workspace/tree.ts packages/agent-core/src/workspace/tree.test.ts packages/agent-core/src/index.ts
git add packages/agent-core/src/workspace/fileOrder.ts packages/agent-core/src/workspace/fileOrder.test.ts packages/agent-core/src/workspace/tree.ts packages/agent-core/src/workspace/tree.test.ts packages/agent-core/src/index.ts
git commit -m "feat(files): persist per-folder custom order in .airlock-order.json"
```

---

## Task 2: pure renderer helpers (applyOrder / dropZone / reorderNames)

**Files:**
- Create: `packages/app/src/renderer/src/lib/fileOrder.ts`
- Test: `packages/app/src/renderer/src/lib/fileOrder.test.ts` (new)

- [ ] **Step 1: Write the failing test.**

Create `packages/app/src/renderer/src/lib/fileOrder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DirEntry } from "../../../shared/ipc";
import { applyOrder, dropZone, reorderNames } from "./fileOrder";

const E = (...names: string[]): DirEntry[] =>
  names.map((name) => ({ name, type: "file" }));

describe("applyOrder", () => {
  it("returns entries unchanged when there is no saved order", () => {
    const entries = E("a", "b");
    expect(applyOrder(entries, undefined)).toBe(entries);
    expect(applyOrder(entries, [])).toBe(entries);
  });
  it("respects the saved order", () => {
    expect(applyOrder(E("a", "b", "c"), ["c", "a", "b"]).map((e) => e.name)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
  it("appends new (unlisted) entries after, in incoming order", () => {
    expect(applyOrder(E("a", "b", "new"), ["b", "a"]).map((e) => e.name)).toEqual([
      "b",
      "a",
      "new",
    ]);
  });
  it("drops saved names with no matching entry", () => {
    expect(applyOrder(E("a"), ["gone", "a"]).map((e) => e.name)).toEqual(["a"]);
  });
});

describe("dropZone", () => {
  const rect = { top: 0, height: 20 };
  it("splits a file row at the midpoint", () => {
    expect(dropZone(rect, 5, false)).toBe("before");
    expect(dropZone(rect, 15, false)).toBe("after");
  });
  it("gives a dir row before/into/after bands", () => {
    expect(dropZone(rect, 2, true)).toBe("before");
    expect(dropZone(rect, 10, true)).toBe("into");
    expect(dropZone(rect, 18, true)).toBe("after");
  });
});

describe("reorderNames", () => {
  it("moves dragged after the target", () => {
    expect(reorderNames(["a", "b", "c"], "a", "b", "after")).toEqual(["b", "a", "c"]);
  });
  it("moves dragged before the target", () => {
    expect(reorderNames(["a", "b", "c"], "c", "a", "before")).toEqual(["c", "a", "b"]);
  });
  it("is a no-op when dragged equals target", () => {
    const names = ["a", "b"];
    expect(reorderNames(names, "a", "a", "after")).toBe(names);
  });
  it("returns the input unchanged when the target is absent", () => {
    const names = ["a", "b"];
    expect(reorderNames(names, "a", "zzz", "after")).toBe(names);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `npx vitest run packages/app/src/renderer/src/lib/fileOrder.test.ts`
Expected: FAIL -- cannot resolve `./fileOrder`.

- [ ] **Step 3: Implement the helpers.**

Create `packages/app/src/renderer/src/lib/fileOrder.ts`:

```ts
import type { DirEntry } from "../../../shared/ipc";

// Apply a saved name order to the default-sorted entries. Saved names that still
// exist come first in saved order; entries not named (new since the last save)
// keep their incoming (default-sort) order at the end; saved names with no entry
// (deleted/renamed) are dropped. No saved order -> entries returned as-is (same
// reference, so callers can cheaply skip re-renders).
export function applyOrder(
  entries: DirEntry[],
  names: string[] | undefined,
): DirEntry[] {
  if (!names || names.length === 0) return entries;
  const byName = new Map(entries.map((e) => [e.name, e]));
  const ordered: DirEntry[] = [];
  for (const n of names) {
    const e = byName.get(n);
    if (e) {
      ordered.push(e);
      byName.delete(n);
    }
  }
  for (const e of entries) if (byName.has(e.name)) ordered.push(e);
  return ordered;
}

// Which band of a row a drag is over, from the pointer Y against the row rect.
// "into" exists only for a directory's middle (move INTO it); a file's whole row
// splits before/after. Drives the reorder-vs-move-into decision in FileTree.
export type Zone = "before" | "after" | "into";
export function dropZone(
  rect: { top: number; height: number },
  clientY: number,
  isDir: boolean,
): Zone {
  const offset = clientY - rect.top;
  if (!isDir) return offset < rect.height / 2 ? "before" : "after";
  const edge = rect.height * 0.25;
  if (offset < edge) return "before";
  if (offset > rect.height - edge) return "after";
  return "into";
}

// Compute a folder's new name order after dropping `dragged` before/after
// `target`. Returns the SAME array reference when nothing changes (dragged ===
// target, or target not present) so callers can skip a needless write.
export function reorderNames(
  names: string[],
  dragged: string,
  target: string,
  place: "before" | "after",
): string[] {
  if (dragged === target) return names;
  const without = names.filter((n) => n !== dragged);
  const ti = without.indexOf(target);
  if (ti < 0) return names;
  const at = place === "before" ? ti : ti + 1;
  return [...without.slice(0, at), dragged, ...without.slice(at)];
}
```

- [ ] **Step 4: Run to verify pass + typecheck.**

Run: `npx vitest run packages/app/src/renderer/src/lib/fileOrder.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Lint + commit.**

```bash
npx biome check --write packages/app/src/renderer/src/lib/fileOrder.ts packages/app/src/renderer/src/lib/fileOrder.test.ts
git add packages/app/src/renderer/src/lib/fileOrder.ts packages/app/src/renderer/src/lib/fileOrder.test.ts
git commit -m "feat(files): applyOrder/dropZone/reorderNames pure helpers"
```

---

## Task 3: IPC surface + watcher ignore

**Files:**
- Modify: `packages/app/src/shared/ipc.ts` (add to `AirlockApi`, ~after `trashFile` at line 247)
- Modify: `packages/app/src/preload/index.ts` (~after `trashFile` at line 39)
- Modify: `packages/app/src/main/ipc.ts` (import + handlers near `fs:trash` ~line 318; `readOrder`/`writeFolderOrder` from `@airlock/agent-core`)
- Modify: `packages/app/src/main/fsWatch.ts` (the `ignored` regex, line 18-22; export it)
- Test: `packages/app/src/main/fsWatch.test.ts` (new)

- [ ] **Step 1: Add the two methods to `AirlockApi`.**

In `packages/app/src/shared/ipc.ts`, inside `interface AirlockApi`, after the `trashFile(...)` line:

```ts
  // Manual file ordering (USER action; per-folder custom order persisted to a
  // committed .airlock-order.json at the project root, path-confined). getFileOrder
  // returns the whole map for a root (folderRel -> ordered names); setFileOrder
  // writes one folder's order (empty names clears it). Pure view metadata -- NO
  // file contents cross, only names the tree already shows.
  getFileOrder(root: string): Promise<Record<string, string[]>>;
  setFileOrder(
    root: string,
    folderRel: string,
    names: string[],
  ): Promise<void>;
```

- [ ] **Step 2: Wire the preload bridge.**

In `packages/app/src/preload/index.ts`, in the `api` object, after the `trashFile` line:

```ts
  getFileOrder: (root) => ipcRenderer.invoke("fileOrder:get", root),
  setFileOrder: (root, folderRel, names) =>
    ipcRenderer.invoke("fileOrder:set", root, folderRel, names),
```

- [ ] **Step 3: Add the main handlers.**

In `packages/app/src/main/ipc.ts`, add `readOrder` and `writeFolderOrder` to the existing `@airlock/agent-core` import block (alongside `move`, `duplicate`, etc.). Then, immediately after the `fs:trash` handler block, add:

```ts
  ipcMain.handle("fileOrder:get", (e, root: unknown) =>
    readOrder(resolveRoot(e, root)),
  );
  ipcMain.handle(
    "fileOrder:set",
    (e, root: unknown, folderRel: unknown, names: unknown) => {
      if (
        typeof folderRel !== "string" ||
        !Array.isArray(names) ||
        !allStr(names)
      )
        throw new Error("Invalid payload");
      return writeFolderOrder(
        resolveRoot(e, root),
        folderRel,
        names as string[],
      );
    },
  );
```

(`allStr` and `resolveRoot` already exist in this file.)

- [ ] **Step 4: Write the failing watcher test.**

Create `packages/app/src/main/fsWatch.test.ts`:

```ts
import { expect, it } from "vitest";
import { isIgnored } from "./fsWatch";

it("ignores the committed order file (no re-list churn on write)", () => {
  expect(isIgnored("/proj/.airlock-order.json")).toBe(true);
});
it("ignores the vault and VCS/build dirs", () => {
  expect(isIgnored("/proj/.airlock/names.json")).toBe(true);
  expect(isIgnored("/proj/node_modules/x/index.js")).toBe(true);
});
it("does not ignore ordinary source files", () => {
  expect(isIgnored("/proj/src/app.ts")).toBe(false);
});
```

- [ ] **Step 5: Run to verify it fails.**

Run: `npx vitest run packages/app/src/main/fsWatch.test.ts`
Expected: FAIL -- `isIgnored` is not exported.

- [ ] **Step 6: Update + export the watcher's ignore predicate.**

In `packages/app/src/main/fsWatch.ts`, replace the private `ignored` function with an exported `isIgnored` that also matches the order file, and update its two call sites (the `watch(root, { ignored: isIgnored, ... })` option and any direct calls):

```ts
// Exported for unit tests. Matches VCS/build dirs, the .airlock vault, and the
// committed .airlock-order.json (so writing the order file never fires a
// debounced fs:changed re-list).
export function isIgnored(p: string): boolean {
  return /(^|[/\\])(\.git|node_modules|\.airlock|\.airlock-order\.json|dist|out|\.DS_Store)([/\\]|$)/.test(
    p,
  );
}
```

Then in `syncWindowWatchers`, change the watch option from `ignored` to `ignored: isIgnored` (i.e., `watch(root, { ignored: isIgnored, ignoreInitial: true, awaitWriteFinish: {...} })`).

- [ ] **Step 7: Run tests + typecheck.**

Run: `npx vitest run packages/app/src/main/fsWatch.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors (the new `AirlockApi` methods are implemented in preload, so the `AirlockApi` type is satisfied).

- [ ] **Step 8: Lint + commit.**

```bash
npx biome check --write packages/app/src/shared/ipc.ts packages/app/src/preload/index.ts packages/app/src/main/ipc.ts packages/app/src/main/fsWatch.ts packages/app/src/main/fsWatch.test.ts
git add packages/app/src/shared/ipc.ts packages/app/src/preload/index.ts packages/app/src/main/ipc.ts packages/app/src/main/fsWatch.ts packages/app/src/main/fsWatch.test.ts
git commit -m "feat(files): fileOrder get/set IPC + ignore order file in watcher"
```

---

## Task 4: store state (fileOrder + loadFileOrder + setFolderOrder)

**Files:**
- Modify: `packages/app/src/renderer/src/store.ts` (interface ~line 333; implementation ~line 1191, near `fsVersion`)
- Test: `packages/app/src/renderer/src/store.fileOrder.test.ts` (new)

- [ ] **Step 1: Write the failing test.**

Create `packages/app/src/renderer/src/store.fileOrder.test.ts`:

```ts
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApp } from "./store";

const initialState = useApp.getState();
const ROOT = "/workspace";

let getFileOrder: ReturnType<typeof vi.fn>;
let setFileOrder: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getFileOrder = vi.fn(() => Promise.resolve({ ".": ["b.ts", "a.ts"] }));
  setFileOrder = vi.fn(() => Promise.resolve(undefined));
  (globalThis as { window?: unknown }).window = {
    airlock: { getFileOrder, setFileOrder },
  };
  useApp.setState(initialState, true);
});
afterEach(() => useApp.setState(initialState, true));

it("loadFileOrder pulls the saved map into the store", async () => {
  await useApp.getState().loadFileOrder(ROOT);
  expect(getFileOrder).toHaveBeenCalledWith(ROOT);
  expect(useApp.getState().fileOrder[ROOT]).toEqual({ ".": ["b.ts", "a.ts"] });
});

it("setFolderOrder optimistically updates the store and persists", async () => {
  await useApp.getState().setFolderOrder(ROOT, "src", ["y.ts", "x.ts"]);
  expect(useApp.getState().fileOrder[ROOT]?.src).toEqual(["y.ts", "x.ts"]);
  expect(setFileOrder).toHaveBeenCalledWith(ROOT, "src", ["y.ts", "x.ts"]);
});

it("setFolderOrder rolls back when the write rejects", async () => {
  setFileOrder.mockReturnValueOnce(Promise.reject(new Error("disk full")));
  await useApp.getState().setFolderOrder(ROOT, "src", ["y.ts"]);
  // src had no prior order -> rollback removes the key entirely.
  expect(useApp.getState().fileOrder[ROOT]?.src).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `npx vitest run packages/app/src/renderer/src/store.fileOrder.test.ts`
Expected: FAIL -- `loadFileOrder` / `setFolderOrder` are not functions.

- [ ] **Step 3: Add the interface members.**

In `packages/app/src/renderer/src/store.ts`, in the `AppState` interface right after `bumpFsVersion: (root: string) => void;` (line 334):

```ts
  // Per-folder custom file order, keyed by root then folderRel ("." = that
  // root's top level). Loaded from the committed .airlock-order.json
  // (loadFileOrder) and written through on reorder (setFolderOrder). An absent
  // folder key means default sort.
  fileOrder: Record<string, Record<string, string[]>>;
  loadFileOrder: (root: string) => Promise<void>;
  setFolderOrder: (
    root: string,
    folderRel: string,
    names: string[],
  ) => Promise<void>;
```

- [ ] **Step 4: Add the implementation.**

In `packages/app/src/renderer/src/store.ts`, right after the `bumpFsVersion` implementation (line 1195-1198):

```ts
  fileOrder: {},
  // Pull a root's saved order map into the store. Idempotent -- a re-load just
  // refreshes it. Triggered by a FileTree effect on root change (Task 5).
  loadFileOrder: async (root) => {
    try {
      const map = await window.airlock.getFileOrder(root);
      set((s) => ({ fileOrder: { ...s.fileOrder, [root]: map } }));
    } catch (err) {
      console.error("loadFileOrder failed", err);
    }
  },
  // Optimistically set one folder's order, then persist. On an IPC failure roll
  // back to the previous order so the view matches what is on disk.
  setFolderOrder: async (root, folderRel, names) => {
    const prev = useApp.getState().fileOrder[root]?.[folderRel];
    set((s) => {
      const forRoot = { ...(s.fileOrder[root] ?? {}) };
      if (names.length === 0) delete forRoot[folderRel];
      else forRoot[folderRel] = names;
      return { fileOrder: { ...s.fileOrder, [root]: forRoot } };
    });
    try {
      await window.airlock.setFileOrder(root, folderRel, names);
    } catch (err) {
      console.error("setFolderOrder failed", err);
      set((s) => {
        const forRoot = { ...(s.fileOrder[root] ?? {}) };
        if (prev === undefined) delete forRoot[folderRel];
        else forRoot[folderRel] = prev;
        return { fileOrder: { ...s.fileOrder, [root]: forRoot } };
      });
    }
  },
```

- [ ] **Step 5: Run tests + typecheck.**

Run: `npx vitest run packages/app/src/renderer/src/store.fileOrder.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Lint + commit.**

```bash
npx biome check --write packages/app/src/renderer/src/store.ts packages/app/src/renderer/src/store.fileOrder.test.ts
git add packages/app/src/renderer/src/store.ts packages/app/src/renderer/src/store.fileOrder.test.ts
git commit -m "feat(files): store fileOrder state with load + write-through reorder"
```

---

## Task 5: apply the saved order when rendering the tree

**Files:**
- Modify: `packages/app/src/renderer/src/components/FileTree.tsx`
- Test: `packages/app/src/renderer/src/components/FileTree.order.test.tsx` (new)

This task makes the tree RENDER in saved order and load it on mount. No drag changes yet.

- [ ] **Step 1: Write the failing test.**

Create `packages/app/src/renderer/src/components/FileTree.order.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DirEntry } from "../../../shared/ipc";
import { ProjectPaneContext } from "../lib/projectPane";
import { useApp } from "../store";
import { FileTree } from "./FileTree";

const initialState = useApp.getState();
const ROOT = "/workspace";
const ENTRIES: DirEntry[] = [
  { name: "a.ts", type: "file" },
  { name: "b.ts", type: "file" },
];

beforeEach(() => {
  window.airlock = new Proxy(
    {
      listDir: () => Promise.resolve(ENTRIES),
      getFileOrder: () => Promise.resolve({ ".": ["b.ts", "a.ts"] }),
    },
    {
      get: (t, p) =>
        p in t
          ? (t as Record<string, unknown>)[p as string]
          : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
  useApp.setState(initialState, true);
});
afterEach(() => cleanup());

function seedRoot(): string {
  const tabId = useApp.getState().tabs[0]?.id as string;
  const cur = useApp.getState().tabState[tabId];
  if (!cur) throw new Error("no tabState");
  useApp.setState({
    tabState: { ...useApp.getState().tabState, [tabId]: { ...cur, root: ROOT } },
  });
  return tabId;
}

it("renders entries in the saved custom order", async () => {
  const tabId = seedRoot();
  const { container } = render(
    <ProjectPaneContext.Provider value={tabId}>
      <FileTree />
    </ProjectPaneContext.Provider>,
  );
  await waitFor(() => {
    const rows = [...container.querySelectorAll(".tree-item")].map(
      (n) => n.textContent,
    );
    // b.ts before a.ts per the saved order (default sort would be a, b).
    expect(rows).toEqual(["b.ts", "a.ts"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `npx vitest run packages/app/src/renderer/src/components/FileTree.order.test.tsx`
Expected: FAIL -- rows render in default order `["a.ts", "b.ts"]`.

- [ ] **Step 3: Apply order + load it, in `FileTree.tsx`.**

Add the import at the top of `FileTree.tsx`:

```ts
import { applyOrder } from "../lib/fileOrder";
```

In the `FileTree` component, read the saved order and load it on root change. After the existing `fsVersion` selector line (`const fsVersion = useApp(...)`) add:

```ts
  const rootOrder = useApp((s) => (root ? s.fileOrder[root] : undefined));
  const loadFileOrder = useApp((s) => s.loadFileOrder);
  useEffect(() => {
    if (root) void loadFileOrder(root);
  }, [root, loadFileOrder]);
```

In `FileTree`, after the `if (!entries) return <div className="tree-empty">...` guard and before the main `return (`, compute the ordered list once:

```ts
  const rootOrdered = applyOrder(entries, rootOrder?.["."]);
```

Then change the root entries map (the `entries.map((e) => <Node ... />)` near the end) to map `rootOrdered`:

```tsx
        {rootOrdered.map((e) => (
          <Node key={e.name} entry={e} parent="." />
        ))}
```

In `DirNode`, read this folder's saved order from the store and apply it. Add near the other `useApp` selectors in `DirNode`:

```ts
  const folderOrder = useApp((s) =>
    root ? s.fileOrder[root]?.[relPath] : undefined,
  );
```

After `DirNode`'s rename-input early-return and before its `return (`, compute the ordered children once:

```ts
  const dirOrdered = applyOrder(children ?? [], folderOrder);
```

Then change the children map (`children?.map((c) => <Node ... />)`) to map `dirOrdered`:

```tsx
          {dirOrdered.map((c) => (
            <Node key={c.name} entry={c} parent={relPath} />
          ))}
```

- [ ] **Step 4: Run the new test + the existing FileTree tests + typecheck.**

Run: `npx vitest run packages/app/src/renderer/src/components/`
Expected: PASS (new order test + existing menu/dnd tests unaffected).
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Lint + commit.**

```bash
npx biome check --write packages/app/src/renderer/src/components/FileTree.tsx packages/app/src/renderer/src/components/FileTree.order.test.tsx
git add packages/app/src/renderer/src/components/FileTree.tsx packages/app/src/renderer/src/components/FileTree.order.test.tsx
git commit -m "feat(files): render the file tree in saved custom order"
```

---

## Task 6: drag-to-reorder (zone-aware handlers + insertion line)

**Files:**
- Modify: `packages/app/src/renderer/src/components/FileTree.tsx`
- Modify: `packages/app/src/renderer/src/theme.css`
- Test: `packages/app/src/renderer/src/components/FileTree.reorder.test.tsx` (new)

This replaces the per-row inline drag handlers with one `useRowDnd` hook that decides reorder vs move-into by pointer band, and threads `parent` + `siblings` to each row.

- [ ] **Step 1: Write the failing test.**

Create `packages/app/src/renderer/src/components/FileTree.reorder.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DirEntry } from "../../../shared/ipc";
import { ProjectPaneContext } from "../lib/projectPane";
import { useApp } from "../store";
import { FileTree } from "./FileTree";

const initialState = useApp.getState();
const ROOT = "/workspace";
const ROOT_ENTRIES: DirEntry[] = [
  { name: "a.ts", type: "file" },
  { name: "b.ts", type: "file" },
  { name: "src", type: "dir" },
];
const SRC_ENTRIES: DirEntry[] = [{ name: "c.ts", type: "file" }];

let moveFile: ReturnType<typeof vi.fn>;
let setFileOrder: ReturnType<typeof vi.fn>;
let getFileOrder: ReturnType<typeof vi.fn>;

beforeEach(() => {
  moveFile = vi.fn(() => Promise.resolve(undefined));
  setFileOrder = vi.fn(() => Promise.resolve(undefined));
  // Configurable so a test can seed a saved order (the mount-time loadFileOrder
  // effect calls this and overwrites any directly-seeded store state).
  getFileOrder = vi.fn(() => Promise.resolve({}));
  window.airlock = new Proxy(
    {
      listDir: (_r: string, rel: string) =>
        Promise.resolve(rel === "src" ? SRC_ENTRIES : ROOT_ENTRIES),
      getFileOrder,
      moveFile,
      setFileOrder,
    },
    {
      get: (t, p) =>
        p in t
          ? (t as Record<string, unknown>)[p as string]
          : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
  useApp.setState(initialState, true);
});
afterEach(() => cleanup());

function seedRoot(): string {
  const tabId = useApp.getState().tabs[0]?.id as string;
  const cur = useApp.getState().tabState[tabId];
  if (!cur) throw new Error("no tabState");
  useApp.setState({
    tabState: { ...useApp.getState().tabState, [tabId]: { ...cur, root: ROOT } },
  });
  return tabId;
}
const renderTree = (tabId: string) =>
  render(
    <ProjectPaneContext.Provider value={tabId}>
      <FileTree />
    </ProjectPaneContext.Provider>,
  );
const dt = () => ({
  setData: vi.fn(),
  getData: vi.fn(() => ""),
  effectAllowed: "",
  dropEffect: "",
});
// jsdom getBoundingClientRect returns zeros; stub a real rect on a row so a
// chosen clientY lands in a known band.
function stubRect(el: Element, top: number, height: number) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    top,
    height,
    bottom: top + height,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
}

it("dragging a file below a sibling reorders within the folder", async () => {
  const tabId = seedRoot();
  const { findByText } = renderTree(tabId);
  const aRow = await findByText("a.ts");
  const bRow = await findByText("b.ts");
  stubRect(bRow, 0, 20);
  const data = dt();
  fireEvent.dragStart(aRow, { dataTransfer: data });
  fireEvent.dragOver(bRow, { dataTransfer: data, clientY: 15 }); // bottom half = after
  fireEvent.drop(bRow, { dataTransfer: data, clientY: 15 });
  // Root has three siblings; a.ts moves after b.ts, src keeps its tail spot.
  expect(setFileOrder).toHaveBeenCalledWith(ROOT, ".", ["b.ts", "a.ts", "src"]);
  expect(moveFile).not.toHaveBeenCalled();
});

it("dragging across folders moves (does not reorder)", async () => {
  const tabId = seedRoot();
  const { findByText } = renderTree(tabId);
  fireEvent.click(await findByText("src"));
  const cRow = await findByText("c.ts");
  const bRow = await findByText("b.ts");
  stubRect(bRow, 0, 20);
  const data = dt();
  fireEvent.dragStart(cRow, { dataTransfer: data });
  fireEvent.dragOver(bRow, { dataTransfer: data, clientY: 15 });
  fireEvent.drop(bRow, { dataTransfer: data, clientY: 15 });
  expect(moveFile).toHaveBeenCalledWith(ROOT, "src/c.ts", "c.ts");
  expect(setFileOrder).not.toHaveBeenCalled();
});

it("dragging a file onto a folder's middle moves it in", async () => {
  const tabId = seedRoot();
  const { findByText } = renderTree(tabId);
  const aRow = await findByText("a.ts");
  const srcRow = await findByText("src");
  stubRect(srcRow, 0, 20);
  const data = dt();
  fireEvent.dragStart(aRow, { dataTransfer: data });
  fireEvent.dragOver(srcRow, { dataTransfer: data, clientY: 10 }); // middle = into
  fireEvent.drop(srcRow, { dataTransfer: data, clientY: 10 });
  expect(moveFile).toHaveBeenCalledWith(ROOT, "a.ts", "src/a.ts");
  expect(setFileOrder).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `npx vitest run packages/app/src/renderer/src/components/FileTree.reorder.test.tsx`
Expected: FAIL -- reorder is not wired; `setFileOrder` not called (the old handlers treat a same-folder drop as a no-op).

- [ ] **Step 3: Extend the imports + `TreeCtl` + add the `reorder` action.**

In `FileTree.tsx`, extend the lib import:

```ts
import { applyOrder, dropZone, reorderNames } from "../lib/fileOrder";
```

Add `reorder` to the `TreeCtl` interface (after `doMove`):

```ts
  // Reorder `draggedRel` to before/after `targetName` within `folderRel`, using
  // the folder's currently displayed `siblings` names. Persists via the store.
  reorder: (
    folderRel: string,
    draggedRel: string,
    targetName: string,
    place: "before" | "after",
    siblings: string[],
  ) => Promise<void>;
```

In the `FileTree` component, read the store action and define `reorder`. Near the other `useApp` selectors add:

```ts
  const setFolderOrder = useApp((s) => s.setFolderOrder);
```

Add the `reorder` function alongside `doMove` (uses the existing `root`, `dragged`):

```ts
  const reorder = async (
    folderRel: string,
    draggedRel: string,
    targetName: string,
    place: "before" | "after",
    siblings: string[],
  ) => {
    if (!root) return;
    const draggedName = draggedRel.slice(draggedRel.lastIndexOf("/") + 1);
    const next = reorderNames(siblings, draggedName, targetName, place);
    // Skip a no-op write (same content) so an idle drop never marks a folder
    // customized for nothing.
    if (
      next.length === siblings.length &&
      next.every((n, i) => n === siblings[i])
    )
      return;
    await setFolderOrder(root, folderRel, next);
  };
```

Add `reorder` to the `ctl` object literal (after `doMove`).

- [ ] **Step 4: Add the `useRowDnd` hook.**

In `FileTree.tsx`, add this hook (place it after `useTreeCtl` and before `NameInput`):

```tsx
// One drag-and-drop brain per tree row. Decides reorder (insertion line) vs
// move-into by the pointer band, keeping the move-into behavior identical for
// cross-folder drags. `parent` is the row's container relpath; `siblings` is
// that container's currently displayed entry names (post-applyOrder).
type RowIndicator = "into" | "before" | "after" | null;
function useRowDnd(
  relPath: string,
  parent: string,
  siblings: string[],
  isDir: boolean,
) {
  const { dragged, setDragged, canDropInto, doMove, reorder } = useTreeCtl();
  const [indicator, setIndicator] = useState<RowIndicator>(null);
  const name = relPath.slice(relPath.lastIndexOf("/") + 1);
  const draggedName = dragged
    ? dragged.slice(dragged.lastIndexOf("/") + 1)
    : "";

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", relPath);
    setDragged(relPath);
  };
  const onDragEnd = () => {
    setDragged(null);
    setIndicator(null);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!dragged) return;
    const sibling = parentOf(dragged) === parent;
    const z = dropZone(
      e.currentTarget.getBoundingClientRect(),
      e.clientY,
      isDir,
    );
    if (sibling && (z === "before" || z === "after")) {
      if (name === draggedName) return; // never reorder a row against itself
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      setIndicator(z);
      return;
    }
    // Move intent (existing behavior): a dir takes the drop INTO itself; a file
    // resolves to its own folder. Cross-folder drags always land here.
    const target = isDir ? relPath : parent;
    if (!canDropInto(target)) {
      setIndicator(null);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setIndicator("into");
  };
  const onDragLeave = () => setIndicator(null);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ind = indicator;
    setIndicator(null);
    if (!dragged) return;
    if (ind === "before" || ind === "after") {
      void reorder(parent, dragged, name, ind, siblings);
    } else {
      void doMove(isDir ? relPath : parent);
    }
  };
  // Map the indicator to a className suffix: into reuses the move-into highlight.
  const cls =
    indicator === "into"
      ? " drop-target"
      : indicator === "before"
        ? " insert-before"
        : indicator === "after"
          ? " insert-after"
          : "";
  return { cls, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop };
}
```

- [ ] **Step 5: Thread `parent` + `siblings` through `Node` and the rows.**

Change `Node` to accept and forward them:

```tsx
function Node({
  entry,
  parent,
  siblings,
}: {
  entry: DirEntry;
  parent: string;
  siblings: string[];
}) {
  const relPath = join(parent, entry.name);
  if (entry.type === "dir")
    return (
      <DirNode
        name={entry.name}
        relPath={relPath}
        parent={parent}
        siblings={siblings}
      />
    );
  return (
    <FileNode
      name={entry.name}
      relPath={relPath}
      parent={parent}
      siblings={siblings}
    />
  );
}
```

Reuse the `rootOrdered` / `dirOrdered` consts added in Task 5; add a names list next to each, and pass `siblings` at the two `Node` call sites.

In `FileTree`, next to `const rootOrdered = ...`:

```ts
  const rootNames = rootOrdered.map((e) => e.name);
```

and the root map becomes:

```tsx
        {rootOrdered.map((e) => (
          <Node key={e.name} entry={e} parent="." siblings={rootNames} />
        ))}
```

In `DirNode`, next to `const dirOrdered = ...`:

```ts
  const dirNames = dirOrdered.map((e) => e.name);
```

and the children map becomes:

```tsx
          {dirOrdered.map((c) => (
            <Node key={c.name} entry={c} parent={relPath} siblings={dirNames} />
          ))}
```

- [ ] **Step 6: Rewrite `FileNode` to use the hook.**

Replace `FileNode`'s signature and its drag handlers. New signature + body (keep the rename-input branch and the `openMenu`/`openEditorFile` wiring; only the drag wiring and className change):

```tsx
function FileNode({
  name,
  relPath,
  parent,
  siblings,
}: {
  name: string;
  relPath: string;
  parent: string;
  siblings: string[];
}) {
  const tabId = useProjectTab();
  const selectedFile = useApp((s) => s.tabState[tabId]?.selectedFile ?? null);
  const { editing, setEditing, openMenu, doRename } = useTreeCtl();
  const dnd = useRowDnd(relPath, parent, siblings, false);

  if (editing?.kind === "rename" && editing.relPath === relPath) {
    return (
      <NameInput
        initial={name}
        selectBase
        onCommit={(n) => doRename(relPath, n)}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <button
      type="button"
      className={`tree-item${selectedFile === relPath ? " selected" : ""}${dnd.cls}`}
      draggable
      onClick={() => void openEditorFile(tabId, relPath)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu({ x: e.clientX, y: e.clientY, kind: "file", relPath });
      }}
      onDragStart={dnd.onDragStart}
      onDragEnd={dnd.onDragEnd}
      onDragOver={dnd.onDragOver}
      onDragLeave={dnd.onDragLeave}
      onDrop={dnd.onDrop}
    >
      <i className="codicon codicon-file" />
      {name}
    </button>
  );
}
```

- [ ] **Step 7: Rewrite `DirNode`'s row to use the hook.**

In `DirNode`, change the signature to accept `parent` + `siblings`, drop the now-unused `canDropInto`/`doMove`/`setDragged` from its `useTreeCtl()` destructure (the hook owns drag now; keep `editing`, `setEditing`, `openMenu`, `doCreateFile`, `doCreateDir`, `doRename`), and call `useRowDnd(relPath, parent, siblings, true)`. Replace the dir button's drag handlers + className the same way as `FileNode`:

```tsx
function DirNode({
  name,
  relPath,
  parent,
  siblings,
}: {
  name: string;
  relPath: string;
  parent: string;
  siblings: string[];
}) {
  const tabId = useProjectTab();
  const root = useApp((s) => s.tabState[tabId]?.root ?? null);
  const fsVersion = useApp((s) => (root ? (s.fsVersion[root] ?? 0) : 0));
  const folderOrder = useApp((s) =>
    root ? s.fileOrder[root]?.[relPath] : undefined,
  );
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const { editing, setEditing, openMenu, doCreateFile, doCreateDir, doRename } =
    useTreeCtl();
  const dnd = useRowDnd(relPath, parent, siblings, true);

  // ... keep the existing children-loading effect and `creating` computation ...
  // ... keep the rename-input early-return branch ...

  // From Task 5; declared after the rename early-return, before this return.
  const dirOrdered = applyOrder(children ?? [], folderOrder);
  const dirNames = dirOrdered.map((e) => e.name);

  return (
    <div>
      <button
        type="button"
        className={`tree-item dir${dnd.cls}`}
        draggable
        onClick={() => setOpen((o) => !o)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openMenu({ x: e.clientX, y: e.clientY, kind: "dir", relPath });
        }}
        onDragStart={dnd.onDragStart}
        onDragEnd={dnd.onDragEnd}
        onDragOver={dnd.onDragOver}
        onDragLeave={dnd.onDragLeave}
        onDrop={dnd.onDrop}
      >
        <i className={`codicon codicon-chevron-${open ? "down" : "right"}`} />
        {name}
      </button>
      {(open || creating) && (
        <div className="tree-children">
          {/* keep the two create NameInput branches unchanged */}
          {dirOrdered.map((c) => (
            <Node key={c.name} entry={c} parent={relPath} siblings={dirNames} />
          ))}
        </div>
      )}
    </div>
  );
}
```

(The `folderOrder` selector and the `dirOrdered` const were added in Task 5; keep a single copy. Leave the existing children-loading `useEffect`, the `creating` variable, and the rename-input early-return exactly as they are.)

- [ ] **Step 8: Add the insertion-line CSS.**

In `packages/app/src/renderer/src/theme.css`, next to the existing `.tree-item.drop-target` rule, add (an inset box-shadow draws the line without shifting layout):

```css
.tree-item.insert-before {
  box-shadow: inset 0 2px 0 0 var(--accent, #4a9eff);
}

.tree-item.insert-after {
  box-shadow: inset 0 -2px 0 0 var(--accent, #4a9eff);
}
```

- [ ] **Step 9: Run the reorder test + the whole component + lib suite + typecheck.**

Run: `npx vitest run packages/app/src/renderer/src/components/ packages/app/src/renderer/src/lib/`
Expected: PASS -- the new reorder test, plus the existing `FileTree.dnd`/`FileTree.menu`/`FileTree.order` tests still green (the move-into path is preserved by the hook).
Run: `npm run typecheck`
Expected: no errors (no unused `canDropInto`/`doMove` left in `DirNode`).

- [ ] **Step 10: Lint + commit.**

```bash
npx biome check --write packages/app/src/renderer/src/components/FileTree.tsx packages/app/src/renderer/src/components/FileTree.reorder.test.tsx packages/app/src/renderer/src/theme.css
git add packages/app/src/renderer/src/components/FileTree.tsx packages/app/src/renderer/src/components/FileTree.reorder.test.tsx packages/app/src/renderer/src/theme.css
git commit -m "feat(files): drag-to-reorder within a folder via pointer-band drop zones"
```

---

## Task 7: "Sort A-Z" reset in the context menu

**Files:**
- Modify: `packages/app/src/renderer/src/components/FileTree.tsx` (the context-menu JSX)
- Test: `packages/app/src/renderer/src/components/FileTree.reorder.test.tsx` (add one case)

- [ ] **Step 1: Add the failing test case.**

Append to `FileTree.reorder.test.tsx`:

```tsx
it("Sort A-Z clears a folder's custom order", async () => {
  // Seed through the mock: the mount-time loadFileOrder effect overwrites the
  // store with getFileOrder's result, so seeding the store directly would not
  // survive. findByText("Sort A-Z") then waits for the order to load + menu open.
  getFileOrder.mockReturnValue(Promise.resolve({ src: ["z.ts"] }));
  const tabId = seedRoot();
  const { findByText } = renderTree(tabId);
  const srcRow = await findByText("src");
  fireEvent.contextMenu(srcRow);
  fireEvent.click(await findByText("Sort A-Z"));
  expect(setFileOrder).toHaveBeenCalledWith(ROOT, "src", []);
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `npx vitest run packages/app/src/renderer/src/components/FileTree.reorder.test.tsx`
Expected: FAIL -- there is no "Sort A-Z" menu item.

- [ ] **Step 3: Add the menu item.**

In `FileTree.tsx`, read the per-root order map in the `FileTree` component (it already has `rootOrder` from Task 5). The menu renders from `menu` (`kind: "file" | "dir" | "bg"`). The reset applies to a FOLDER: for `kind === "dir"` the folder is `menu.relPath`; for `kind === "bg"` it is `"."`. Show the item only when that folder currently has a saved order.

Add a helper near `createParent()`:

```tsx
  // The folder a reset/reorder applies to for the current menu target, or null
  // for a file row (files do not own an order). "." for the background (root).
  const menuFolder = (): string | null => {
    if (!menu) return null;
    if (menu.kind === "bg") return ".";
    if (menu.kind === "dir") return menu.relPath;
    return null;
  };
```

Inside the context-menu `<div className="context-menu" ...>`, after the New File / New Folder buttons, add the conditional reset item:

```tsx
            {(() => {
              const folder = menuFolder();
              if (folder === null || !rootOrder?.[folder]) return null;
              return (
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    void setFolderOrder(root, folder, []);
                    setMenu(null);
                  }}
                >
                  <span>Sort A-Z</span>
                </button>
              );
            })()}
```

(`setFolderOrder` was wired into the component in Task 6; `root` is the non-null root guaranteed by the early `if (!root) return null;`.)

- [ ] **Step 4: Run the test + full component suite + typecheck.**

Run: `npx vitest run packages/app/src/renderer/src/components/`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Lint + commit.**

```bash
npx biome check --write packages/app/src/renderer/src/components/FileTree.tsx packages/app/src/renderer/src/components/FileTree.reorder.test.tsx
git add packages/app/src/renderer/src/components/FileTree.tsx packages/app/src/renderer/src/components/FileTree.reorder.test.tsx
git commit -m "feat(files): Sort A-Z context-menu reset to default order"
```

---

## Final verification (after all tasks)

- [ ] Run the full suite: `npx vitest run` -- all green.
- [ ] `npm run typecheck` -- clean.
- [ ] `npx biome check .` -- clean.
- [ ] `npm run package` -- builds the macOS app for the owner to gate.

## Manual gate checklist (for the owner)

- Drag a file above/below a sibling -> it reorders; an insertion line shows where it lands.
- Reorder survives an app relaunch (persisted) and a `git status` shows a tracked `.airlock-order.json`.
- Drag a file onto a folder's middle -> it still moves INTO the folder (not reorder).
- Drag a file across folders -> it moves (appends), does not reorder.
- Create a new file in a reordered folder -> it appears at the bottom.
- Right-click a reordered folder -> "Sort A-Z" -> returns to folders-first + A-Z.
