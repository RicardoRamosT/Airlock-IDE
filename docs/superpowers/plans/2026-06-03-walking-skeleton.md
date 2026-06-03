# Airlock Walking Skeleton (Weeks 1–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A launchable Electron app where you can open a folder, browse its files, view a file read-only with syntax highlighting, and use a real terminal — the spec §12 gate: "I can live in it as a terminal."

**Architecture:** npm-workspaces monorepo. `packages/agent-core` owns everything that touches the machine (PTY sessions, workspace file access with path containment) and never imports Electron. `packages/app` is the Electron shell: sandboxed React renderer ↔ typed IPC ↔ main process, which calls agent-core. This boundary is the load-bearing wall from the spec (§4–§5) — it exists from the first commit.

**Tech Stack:** Electron + electron-vite, React 18 + Zustand, `@xterm/xterm` + `node-pty`, CodeMirror 6 (read-only), TypeScript strict, vitest, biome.

**Spec:** `docs/superpowers/specs/2026-06-03-airlock-v1-design.md`

---

## File structure

```text
airlock/
  package.json                  # workspaces root: scripts, build tooling devDeps
  tsconfig.base.json            # strict TS shared config
  biome.json                    # lint/format
  vitest.config.ts              # runs packages/*/src/**/*.test.{ts,tsx}
  packages/
    agent-core/
      package.json              # @airlock/agent-core — dep: node-pty
      tsconfig.json
      src/
        index.ts                # ONLY public surface
        pty/session.ts          # PtySession (spawn/write/resize/kill/onData/onExit)
        pty/session.test.ts
        workspace/tree.ts       # resolveWithin (containment) + listDirectory
        workspace/tree.test.ts
        workspace/read.ts       # readWorkspaceFile (containment + 1MB cap)
        workspace/read.test.ts
    app/
      package.json              # @airlock/app — react, xterm, codemirror, zustand
      tsconfig.json
      electron.vite.config.ts
      src/
        main/index.ts           # window lifecycle
        main/ipc.ts             # IPC handlers → agent-core; PTY session registry
        preload/index.ts        # contextBridge: window.airlock (typed)
        shared/ipc.ts           # channel names + AirlockApi type (single source)
        renderer/
          index.html
          src/
            main.tsx
            App.tsx             # 3-column layout
            store.ts            # zustand: root, selectedFile, file
            theme.css           # calm dark theme + grid
            global.d.ts         # window.airlock declaration
            lib/language.ts     # extension → language key (pure, tested)
            lib/language.test.ts
            components/Sidebar.tsx      # Files live; Secrets/Git/Agent Log placeholders
            components/FileTree.tsx
            components/Viewer.tsx       # CM6 read-only
            components/TerminalPane.tsx # xterm wiring
            components/AgentPane.tsx    # "agent arrives week 3" empty state
```

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `biome.json`, `vitest.config.ts`
- Create: `packages/agent-core/package.json`, `packages/agent-core/tsconfig.json`
- Create: `packages/app/package.json`, `packages/app/tsconfig.json`

- [ ] **Step 1: Write root `package.json`**

```json
{
  "name": "airlock",
  "private": true,
  "version": "0.1.0",
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "npm run dev -w @airlock/app",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p packages/agent-core --noEmit && tsc -p packages/app --noEmit",
    "lint": "biome check .",
    "rebuild": "electron-rebuild -f -w node-pty"
  }
}
```

- [ ] **Step 2: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- [ ] **Step 3: Write `biome.json`**

```json
{
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "files": { "ignore": ["**/out/**", "**/dist/**", "**/node_modules/**"] }
}
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
```

- [ ] **Step 5: Write `packages/agent-core/package.json`**

```json
{
  "name": "@airlock/agent-core",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

- [ ] **Step 6: Write `packages/agent-core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src"]
}
```

- [ ] **Step 7: Write `packages/app/package.json`**

```json
{
  "name": "@airlock/app",
  "version": "0.1.0",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build"
  }
}
```

- [ ] **Step 8: Write `packages/app/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["node"]
  },
  "include": ["src", "electron.vite.config.ts"]
}
```

- [ ] **Step 9: Install dependencies (latest versions; do not pin majors by hand)**

```bash
cd /Users/ricardoramos/Projects/airlock
npm install -D electron electron-vite @electron/rebuild typescript vitest @biomejs/biome @vitejs/plugin-react @types/node
npm install node-pty -w @airlock/agent-core
npm install react react-dom zustand @xterm/xterm @xterm/addon-fit codemirror @codemirror/state @codemirror/view @codemirror/language @codemirror/lang-javascript @codemirror/lang-json @codemirror/lang-markdown @codemirror/lang-css @codemirror/lang-html @codemirror/theme-one-dark -w @airlock/app
npm install -D @types/react @types/react-dom -w @airlock/app
npm run rebuild
```

Expected: installs succeed; `npm run rebuild` ends with a successful native rebuild of `node-pty` against Electron's ABI (output mentions "Rebuild Complete" or exits 0).

- [ ] **Step 10: Verify workspaces resolve**

Run: `npm ls --workspaces --depth 0 | head -20`
Expected: both `@airlock/agent-core` and `@airlock/app` listed, no `UNMET DEPENDENCY` lines.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: monorepo scaffold — workspaces, TS strict, vitest, biome, deps"
```

---

### Task 2: PTY session (agent-core, TDD)

**Files:**
- Test: `packages/agent-core/src/pty/session.test.ts`
- Create: `packages/agent-core/src/pty/session.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createPtySession, type PtySession } from './session';

function collectUntilExit(s: PtySession): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    let output = '';
    s.onData((d) => {
      output += d;
    });
    s.onExit((exitCode) => resolve({ output, exitCode }));
  });
}

describe('PtySession', () => {
  it('runs a command and captures its output', async () => {
    const s = createPtySession({ shell: '/bin/zsh', args: ['-c', 'printf MARKER123'] });
    const { output, exitCode } = await collectUntilExit(s);
    expect(output).toContain('MARKER123');
    expect(exitCode).toBe(0);
  }, 10_000);

  it('accepts written input in an interactive shell', async () => {
    const s = createPtySession({ shell: '/bin/zsh' });
    const done = collectUntilExit(s);
    s.write('printf INTERACTIVE_OK\r');
    s.write('exit\r');
    const { output } = await done;
    expect(output).toContain('INTERACTIVE_OK');
  }, 10_000);

  it('resizes without throwing', () => {
    const s = createPtySession({ shell: '/bin/zsh' });
    expect(() => s.resize(120, 40)).not.toThrow();
    s.kill();
  });

  it('gives each session a unique id', () => {
    const a = createPtySession({ shell: '/bin/zsh' });
    const b = createPtySession({ shell: '/bin/zsh' });
    expect(a.id).not.toBe(b.id);
    a.kill();
    b.kill();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agent-core/src/pty/session.test.ts`
Expected: FAIL — cannot resolve `./session`.

- [ ] **Step 3: Implement `session.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { type IPty, spawn } from 'node-pty';

export interface PtyOptions {
  shell?: string;
  args?: string[];
  cwd?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

export class PtySession {
  readonly id: string = randomUUID();
  private readonly pty: IPty;

  constructor(opts: PtyOptions = {}) {
    this.pty = spawn(opts.shell ?? process.env.SHELL ?? '/bin/zsh', opts.args ?? [], {
      name: 'xterm-256color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: opts.cwd ?? homedir(),
      env: { ...process.env, ...opts.env } as Record<string, string>,
    });
  }

  onData(cb: (data: string) => void): void {
    this.pty.onData(cb);
  }

  onExit(cb: (exitCode: number) => void): void {
    this.pty.onExit(({ exitCode }) => cb(exitCode));
  }

  write(data: string): void {
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  kill(): void {
    this.pty.kill();
  }
}

export function createPtySession(opts: PtyOptions = {}): PtySession {
  return new PtySession(opts);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/agent-core/src/pty/session.test.ts`
Expected: 4 passed.
Note: vitest runs under your system Node while `node-pty` was rebuilt for Electron. If you see a `NODE_MODULE_VERSION` mismatch error, run `npm rebuild node-pty` before tests and `npm run rebuild` before `npm run dev`. (If this bites often, we'll add pretest/predev hooks in a later task — not now, YAGNI.)

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/pty
git commit -m "feat(agent-core): PtySession — spawn, io, resize, kill, exit events (TDD)"
```

---

### Task 3: Workspace tree with path containment (agent-core, TDD)

**Files:**
- Test: `packages/agent-core/src/workspace/tree.test.ts`
- Create: `packages/agent-core/src/workspace/tree.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { listDirectory, resolveWithin } from './tree';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'airlock-tree-'));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'index.ts'), 'export {}');
  await writeFile(path.join(root, 'readme.md'), '# hi');
  await mkdir(path.join(root, 'node_modules'));
  await symlink('/etc', path.join(root, 'sneaky'));
});

describe('resolveWithin', () => {
  it('resolves paths inside the root', async () => {
    const p = await resolveWithin(root, 'src');
    expect(p.endsWith('/src')).toBe(true);
  });

  it('rejects .. traversal', async () => {
    await expect(resolveWithin(root, '../outside')).rejects.toThrow(/escapes workspace/);
  });

  it('rejects symlinks that escape the root', async () => {
    await expect(resolveWithin(root, 'sneaky')).rejects.toThrow(/escapes workspace/);
  });
});

describe('listDirectory', () => {
  it('lists dirs first, then files, alphabetically, hiding ignored names', async () => {
    const entries = await listDirectory(root, '.');
    expect(entries).toEqual([
      { name: 'src', type: 'dir' },
      { name: 'readme.md', type: 'file' },
      { name: 'sneaky', type: 'file' },
    ]);
  });

  it('lists a subdirectory', async () => {
    const entries = await listDirectory(root, 'src');
    expect(entries).toEqual([{ name: 'index.ts', type: 'file' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agent-core/src/workspace/tree.test.ts`
Expected: FAIL — cannot resolve `./tree`.

- [ ] **Step 3: Implement `tree.ts`**

```ts
import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export interface DirEntry {
  name: string;
  type: 'file' | 'dir';
}

const IGNORED = new Set(['node_modules', '.git', 'dist', 'out', '.airlock', '.DS_Store']);

/**
 * Resolve relPath against root and guarantee the real (symlink-resolved)
 * location stays inside root. Spec §6: all file tools are workspace-rooted;
 * symlinks resolve before the check.
 */
export async function resolveWithin(root: string, relPath: string): Promise<string> {
  const realRoot = await realpath(path.resolve(root));
  const abs = path.resolve(realRoot, relPath);
  let real: string;
  try {
    real = await realpath(abs);
  } catch {
    // Path may not exist yet (future write_file); containment-check the lexical path.
    real = abs;
  }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new Error(`Path escapes workspace: ${relPath}`);
  }
  return real;
}

export async function listDirectory(root: string, relPath = '.'): Promise<DirEntry[]> {
  const abs = await resolveWithin(root, relPath);
  const dirents = await readdir(abs, { withFileTypes: true });
  return dirents
    .filter((d) => !IGNORED.has(d.name))
    .map<DirEntry>((d) => ({ name: d.name, type: d.isDirectory() ? 'dir' : 'file' }))
    .sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1,
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/agent-core/src/workspace/tree.test.ts`
Expected: 5 passed. (`sneaky` appears in listings as a plain entry, but resolving *into* it throws — listing shows the name; access is what's contained.)

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/workspace
git commit -m "feat(agent-core): workspace listing with symlink-safe path containment (TDD)"
```

---

### Task 4: Workspace file read + public API (agent-core, TDD)

**Files:**
- Test: `packages/agent-core/src/workspace/read.test.ts`
- Create: `packages/agent-core/src/workspace/read.ts`
- Create: `packages/agent-core/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, readWorkspaceFile } from './read';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'airlock-read-'));
  await writeFile(path.join(root, 'small.txt'), 'hello airlock');
  await writeFile(path.join(root, 'big.txt'), Buffer.alloc(MAX_FILE_BYTES + 500_000, 0x61));
});

describe('readWorkspaceFile', () => {
  it('reads a small file fully', async () => {
    const f = await readWorkspaceFile(root, 'small.txt');
    expect(f.content).toBe('hello airlock');
    expect(f.truncated).toBe(false);
  });

  it('caps huge files and flags truncation', async () => {
    const f = await readWorkspaceFile(root, 'big.txt');
    expect(f.content.length).toBe(MAX_FILE_BYTES);
    expect(f.truncated).toBe(true);
  });

  it('rejects traversal outside the workspace', async () => {
    await expect(readWorkspaceFile(root, '../../etc/hosts')).rejects.toThrow(/escapes workspace/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agent-core/src/workspace/read.test.ts`
Expected: FAIL — cannot resolve `./read`.

- [ ] **Step 3: Implement `read.ts`**

```ts
import { open } from 'node:fs/promises';
import { resolveWithin } from './tree';

export interface FileContent {
  content: string;
  truncated: boolean;
}

export const MAX_FILE_BYTES = 1_000_000;

export async function readWorkspaceFile(root: string, relPath: string): Promise<FileContent> {
  const abs = await resolveWithin(root, relPath);
  const fh = await open(abs, 'r');
  try {
    const { size } = await fh.stat();
    if (size <= MAX_FILE_BYTES) {
      const buf = await fh.readFile();
      return { content: buf.toString('utf8'), truncated: false };
    }
    const buf = Buffer.alloc(MAX_FILE_BYTES);
    await fh.read(buf, 0, MAX_FILE_BYTES, 0);
    return { content: buf.toString('utf8'), truncated: true };
  } finally {
    await fh.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/agent-core/src/workspace/read.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Write the public API surface `src/index.ts`**

```ts
// The ONLY import path for consumers. Spec §4: app imports this surface;
// nothing imports agent-core internals.
export { createPtySession, PtySession, type PtyOptions } from './pty/session';
export { listDirectory, resolveWithin, type DirEntry } from './workspace/tree';
export { MAX_FILE_BYTES, readWorkspaceFile, type FileContent } from './workspace/read';
```

- [ ] **Step 6: Run full suite + typecheck**

Run: `npm test && npx tsc -p packages/agent-core --noEmit`
Expected: 12 tests passed; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-core/src
git commit -m "feat(agent-core): capped workspace file read + public API surface (TDD)"
```

---

### Task 5: Electron shell boots

**Files:**
- Create: `packages/app/electron.vite.config.ts`
- Create: `packages/app/src/main/index.ts`
- Create: `packages/app/src/preload/index.ts` (stub)
- Create: `packages/app/src/renderer/index.html`
- Create: `packages/app/src/renderer/src/main.tsx`
- Create: `packages/app/src/renderer/src/App.tsx` (placeholder)
- Create: `packages/app/src/renderer/src/theme.css` (minimal for now)

- [ ] **Step 1: Write `electron.vite.config.ts`**

```ts
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    // Bundle agent-core from TS source; keep the native module external.
    plugins: [externalizeDepsPlugin({ exclude: ['@airlock/agent-core'] })],
    build: { rollupOptions: { external: ['node-pty'] } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
  },
});
```

- [ ] **Step 2: Write `src/main/index.ts`**

```ts
import path from 'node:path';
import { BrowserWindow, app } from 'electron';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0d1117',
    title: 'airlock',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
```

- [ ] **Step 3: Write preload stub `src/preload/index.ts`**

```ts
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('airlock', { ready: true });
```

- [ ] **Step 4: Write `src/renderer/index.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    />
    <title>airlock</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Write `src/renderer/src/main.tsx`**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 6: Write placeholder `src/renderer/src/App.tsx`**

```tsx
export function App() {
  return <div className="boot">airlock</div>;
}
```

- [ ] **Step 7: Write minimal `src/renderer/src/theme.css`**

```css
:root {
  --bg: #0d1117;
  --bg-panel: #11161d;
  --border: #1f2630;
  --fg: #c9d1d9;
  --fg-dim: #8b949e;
  --accent: #58a6ff;
  font-family: -apple-system, 'SF Pro Text', sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  margin: 0;
  height: 100%;
  background: var(--bg);
  color: var(--fg);
}

.boot {
  display: grid;
  place-items: center;
  height: 100%;
  font-size: 14px;
  color: var(--fg-dim);
  letter-spacing: 0.3em;
}
```

- [ ] **Step 8: Launch and verify**

Run: `npm run dev`
Expected: a dark window titled "airlock" opens showing the centered word "airlock". No devtools errors. Quit with `cmd+Q`.

- [ ] **Step 9: Commit**

```bash
git add packages/app
git commit -m "feat(app): Electron shell boots — sandboxed renderer, CSP, dark theme"
```

---

### Task 6: Typed IPC bridge

**Files:**
- Create: `packages/app/src/shared/ipc.ts`
- Create: `packages/app/src/main/ipc.ts`
- Modify: `packages/app/src/main/index.ts` (register IPC, kill PTYs on quit)
- Modify: `packages/app/src/preload/index.ts` (real API)
- Create: `packages/app/src/renderer/src/global.d.ts`

- [ ] **Step 1: Write the single source of IPC truth `src/shared/ipc.ts`**

```ts
import type { DirEntry, FileContent } from '@airlock/agent-core';

export type { DirEntry, FileContent };

export interface PtyDataEvent {
  id: string;
  data: string;
}

export interface PtyExitEvent {
  id: string;
  exitCode: number;
}

/** Exposed on window.airlock by the preload script. */
export interface AirlockApi {
  openFolder(): Promise<string | null>;
  listDir(relPath: string): Promise<DirEntry[]>;
  readFile(relPath: string): Promise<FileContent>;
  ptyCreate(cols: number, rows: number): Promise<string>;
  ptyInput(id: string, data: string): void;
  ptyResize(id: string, cols: number, rows: number): void;
  onPtyData(cb: (e: PtyDataEvent) => void): () => void;
  onPtyExit(cb: (e: PtyExitEvent) => void): () => void;
}
```

- [ ] **Step 2: Write `src/main/ipc.ts`**

```ts
import {
  createPtySession,
  listDirectory,
  type PtySession,
  readWorkspaceFile,
} from '@airlock/agent-core';
import { dialog, ipcMain } from 'electron';

let workspaceRoot: string | null = null;
const sessions = new Map<string, PtySession>();

function requireRoot(): string {
  if (!workspaceRoot) throw new Error('No workspace open');
  return workspaceRoot;
}

export function registerIpc(): void {
  ipcMain.handle('dialog:openFolder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (r.canceled || r.filePaths.length === 0) return null;
    workspaceRoot = r.filePaths[0] ?? null;
    return workspaceRoot;
  });

  ipcMain.handle('fs:listDir', (_e, relPath: string) => listDirectory(requireRoot(), relPath));

  ipcMain.handle('fs:readFile', (_e, relPath: string) => readWorkspaceFile(requireRoot(), relPath));

  ipcMain.handle('pty:create', (e, cols: number, rows: number) => {
    const s = createPtySession({ cwd: workspaceRoot ?? undefined, cols, rows });
    sessions.set(s.id, s);
    const wc = e.sender;
    s.onData((data) => {
      if (!wc.isDestroyed()) wc.send('pty:data', { id: s.id, data });
    });
    s.onExit((exitCode) => {
      sessions.delete(s.id);
      if (!wc.isDestroyed()) wc.send('pty:exit', { id: s.id, exitCode });
    });
    return s.id;
  });

  ipcMain.on('pty:input', (_e, { id, data }: { id: string; data: string }) => {
    sessions.get(id)?.write(data);
  });

  ipcMain.on('pty:resize', (_e, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    sessions.get(id)?.resize(cols, rows);
  });
}

export function killAllSessions(): void {
  for (const s of sessions.values()) s.kill();
  sessions.clear();
}
```

- [ ] **Step 3: Register in `src/main/index.ts`**

Add the import and two lines (full file after edit):

```ts
import path from 'node:path';
import { BrowserWindow, app } from 'electron';
import { killAllSessions, registerIpc } from './ipc';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0d1117',
    title: 'airlock',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
});

app.on('before-quit', killAllSessions);

app.on('window-all-closed', () => {
  app.quit();
});
```

- [ ] **Step 4: Implement the real preload `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { AirlockApi, PtyDataEvent, PtyExitEvent } from '../shared/ipc';

function subscribe<T>(channel: string, cb: (e: T) => void): () => void {
  const handler = (_: unknown, e: T) => cb(e);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: AirlockApi = {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  listDir: (relPath) => ipcRenderer.invoke('fs:listDir', relPath),
  readFile: (relPath) => ipcRenderer.invoke('fs:readFile', relPath),
  ptyCreate: (cols, rows) => ipcRenderer.invoke('pty:create', cols, rows),
  ptyInput: (id, data) => ipcRenderer.send('pty:input', { id, data }),
  ptyResize: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  onPtyData: (cb) => subscribe<PtyDataEvent>('pty:data', cb),
  onPtyExit: (cb) => subscribe<PtyExitEvent>('pty:exit', cb),
};

contextBridge.exposeInMainWorld('airlock', api);
```

- [ ] **Step 5: Write `src/renderer/src/global.d.ts`**

```ts
import type { AirlockApi } from '../../shared/ipc';

declare global {
  interface Window {
    airlock: AirlockApi;
  }
}

export {};
```

- [ ] **Step 6: Typecheck and launch**

Run: `npm run typecheck && npm run dev`
Expected: typecheck clean; window boots as before. In devtools console (`cmd+option+I`): `window.airlock` shows the API object with all 8 methods.

- [ ] **Step 7: Commit**

```bash
git add packages/app
git commit -m "feat(app): typed IPC bridge — folder dialog, fs, pty channels via contextBridge"
```

---

### Task 7: Sidebar + file tree

**Files:**
- Create: `packages/app/src/renderer/src/store.ts`
- Create: `packages/app/src/renderer/src/components/Sidebar.tsx`
- Create: `packages/app/src/renderer/src/components/FileTree.tsx`
- Modify: `packages/app/src/renderer/src/App.tsx`
- Modify: `packages/app/src/renderer/src/theme.css` (append styles)

- [ ] **Step 1: Write `store.ts`**

```ts
import { create } from 'zustand';
import type { FileContent } from '../../shared/ipc';

interface AppState {
  root: string | null;
  selectedFile: string | null;
  file: FileContent | null;
  setRoot: (root: string | null) => void;
  setSelected: (relPath: string | null, file: FileContent | null) => void;
}

export const useApp = create<AppState>((set) => ({
  root: null,
  selectedFile: null,
  file: null,
  setRoot: (root) => set({ root, selectedFile: null, file: null }),
  setSelected: (selectedFile, file) => set({ selectedFile, file }),
}));
```

- [ ] **Step 2: Write `components/FileTree.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { DirEntry } from '../../../shared/ipc';
import { useApp } from '../store';

function join(parent: string, name: string): string {
  return parent === '.' ? name : `${parent}/${name}`;
}

function Node({ entry, parent }: { entry: DirEntry; parent: string }) {
  const relPath = join(parent, entry.name);
  if (entry.type === 'dir') return <DirNode name={entry.name} relPath={relPath} />;
  return <FileNode name={entry.name} relPath={relPath} />;
}

function FileNode({ name, relPath }: { name: string; relPath: string }) {
  const { selectedFile, setSelected } = useApp();
  const select = async () => {
    const file = await window.airlock.readFile(relPath);
    setSelected(relPath, file);
  };
  return (
    <button
      type="button"
      className={`tree-item${selectedFile === relPath ? ' selected' : ''}`}
      onClick={select}
    >
      {name}
    </button>
  );
}

function DirNode({ name, relPath }: { name: string; relPath: string }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && children === null) setChildren(await window.airlock.listDir(relPath));
  };
  return (
    <div>
      <button type="button" className="tree-item dir" onClick={toggle}>
        {open ? '▾' : '▸'} {name}
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

export function FileTree() {
  const root = useApp((s) => s.root);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);

  useEffect(() => {
    if (!root) {
      setEntries(null);
      return;
    }
    window.airlock.listDir('.').then(setEntries);
  }, [root]);

  if (!root) return null;
  if (!entries) return <div className="tree-empty">loading…</div>;
  return (
    <div className="tree">
      {entries.map((e) => (
        <Node key={e.name} entry={e} parent="." />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write `components/Sidebar.tsx`**

```tsx
import { useApp } from '../store';
import { FileTree } from './FileTree';

function Section({ title, children, dim }: { title: string; children?: React.ReactNode; dim?: boolean }) {
  return (
    <div className={`section${dim ? ' dim' : ''}`}>
      <div className="section-title">{title}</div>
      {children}
    </div>
  );
}

export function Sidebar() {
  const { root, setRoot } = useApp();

  const openFolder = async () => {
    const picked = await window.airlock.openFolder();
    if (picked) setRoot(picked);
  };

  return (
    <aside className="sidebar">
      <Section title="Files">
        {root ? (
          <FileTree />
        ) : (
          <button type="button" className="open-folder" onClick={openFolder}>
            Open Folder…
          </button>
        )}
      </Section>
      <Section title="Secrets" dim>
        <div className="section-note">week 3</div>
      </Section>
      <Section title="Git" dim>
        <div className="section-note">week 8</div>
      </Section>
      <Section title="Agent Log" dim>
        <div className="section-note">week 3</div>
      </Section>
    </aside>
  );
}
```

- [ ] **Step 4: Update `App.tsx` to the 3-column grid**

```tsx
import { Sidebar } from './components/Sidebar';
import { useApp } from './store';

export function App() {
  const selectedFile = useApp((s) => s.selectedFile);
  return (
    <div className="layout">
      <Sidebar />
      <main className="editor">
        <div className="empty">{selectedFile ?? 'select a file'}</div>
      </main>
      <div className="right">
        <div className="agent-pane">
          <div className="empty">agent arrives in week 3</div>
        </div>
        <div className="terminal-slot">
          <div className="empty">terminal arrives in task 9</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Append layout styles to `theme.css`**

```css
.layout {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr) 460px;
  height: 100%;
}

.sidebar {
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: 8px 0;
}

.section {
  padding: 6px 10px;
}

.section.dim {
  opacity: 0.45;
}

.section-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fg-dim);
  margin-bottom: 6px;
}

.section-note {
  font-size: 11px;
  color: var(--fg-dim);
}

.tree-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: var(--fg);
  font-size: 13px;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
}

.tree-item:hover {
  background: #1a2129;
}

.tree-item.selected {
  background: #1f3a5f;
}

.tree-item.dir {
  color: var(--fg-dim);
}

.tree-children {
  padding-left: 14px;
}

.tree-empty {
  font-size: 12px;
  color: var(--fg-dim);
}

.open-folder {
  background: var(--accent);
  color: #06121f;
  border: none;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}

.right {
  display: grid;
  grid-template-rows: 2fr 3fr;
  border-left: 1px solid var(--border);
  min-height: 0;
}

.agent-pane {
  border-bottom: 1px solid var(--border);
  min-height: 0;
}

.terminal-slot {
  min-height: 0;
  background: var(--bg);
}

.editor {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.empty {
  display: grid;
  place-items: center;
  height: 100%;
  color: var(--fg-dim);
  font-size: 13px;
}
```

- [ ] **Step 6: Launch and verify manually**

Run: `npm run dev`
Expected: 3-column layout. Click "Open Folder…", pick the airlock repo itself: tree shows `docs`, `packages` (dirs first), `.gitignore`, `package.json`… `node_modules` and `.git` hidden. Expanding dirs works; clicking a file highlights it and the center shows its path.

- [ ] **Step 7: Commit**

```bash
git add packages/app
git commit -m "feat(app): sidebar with live file tree + placeholder sections (Secrets/Git/Agent Log)"
```

---

### Task 8: Read-only viewer (CodeMirror 6)

**Files:**
- Test: `packages/app/src/renderer/src/lib/language.test.ts`
- Create: `packages/app/src/renderer/src/lib/language.ts`
- Create: `packages/app/src/renderer/src/components/Viewer.tsx`
- Modify: `packages/app/src/renderer/src/App.tsx`
- Modify: `packages/app/src/renderer/src/theme.css` (append)

- [ ] **Step 1: Write the failing test for the pure language mapper**

```ts
import { describe, expect, it } from 'vitest';
import { languageKeyForPath } from './language';

describe('languageKeyForPath', () => {
  it.each([
    ['src/App.tsx', 'js'],
    ['index.js', 'js'],
    ['lib/util.mjs', 'js'],
    ['package.json', 'json'],
    ['README.md', 'md'],
    ['theme.css', 'css'],
    ['index.html', 'html'],
  ])('%s → %s', (path, key) => {
    expect(languageKeyForPath(path)).toBe(key);
  });

  it('returns null for unknown extensions', () => {
    expect(languageKeyForPath('rsa_key.pem')).toBeNull();
    expect(languageKeyForPath('Makefile')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/app/src/renderer/src/lib/language.test.ts`
Expected: FAIL — cannot resolve `./language`.

- [ ] **Step 3: Implement `lib/language.ts`**

```ts
export type LanguageKey = 'js' | 'json' | 'md' | 'css' | 'html';

const BY_EXT: Record<string, LanguageKey> = {
  js: 'js',
  jsx: 'js',
  ts: 'js',
  tsx: 'js',
  mjs: 'js',
  cjs: 'js',
  json: 'json',
  md: 'md',
  markdown: 'md',
  css: 'css',
  html: 'html',
  htm: 'html',
};

export function languageKeyForPath(path: string): LanguageKey | null {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return BY_EXT[name.slice(dot + 1).toLowerCase()] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/app/src/renderer/src/lib/language.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Write `components/Viewer.tsx`**

```tsx
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';
import { type LanguageKey, languageKeyForPath } from '../lib/language';
import { useApp } from '../store';

const LANGUAGES: Record<LanguageKey, () => Extension> = {
  js: () => javascript({ jsx: true, typescript: true }),
  json,
  md: markdown,
  css,
  html,
};

export function Viewer() {
  const { selectedFile, file } = useApp();
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !file) return;
    const key = selectedFile ? languageKeyForPath(selectedFile) : null;
    const view = new EditorView({
      state: EditorState.create({
        doc: file.content,
        extensions: [
          basicSetup,
          oneDark,
          EditorState.readOnly.of(true),
          EditorView.theme({ '&': { height: '100%' } }),
          ...(key ? [LANGUAGES[key]()] : []),
        ],
      }),
      parent: host,
    });
    return () => view.destroy();
  }, [selectedFile, file]);

  if (!file) return <div className="empty">select a file</div>;
  return (
    <div className="viewer">
      <div className="viewer-header">
        <span>{selectedFile}</span>
        {file.truncated && <span className="badge">truncated · first 1 MB</span>}
        <span className="badge dim-badge">read-only · editing in week 6</span>
      </div>
      <div ref={hostRef} className="viewer-host" />
    </div>
  );
}
```

- [ ] **Step 6: Use it in `App.tsx`**

Replace the `<main>` block:

```tsx
import { Sidebar } from './components/Sidebar';
import { Viewer } from './components/Viewer';

export function App() {
  return (
    <div className="layout">
      <Sidebar />
      <main className="editor">
        <Viewer />
      </main>
      <div className="right">
        <div className="agent-pane">
          <div className="empty">agent arrives in week 3</div>
        </div>
        <div className="terminal-slot">
          <div className="empty">terminal arrives in task 9</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Append viewer styles to `theme.css`**

```css
.viewer {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100%;
}

.viewer-header {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--fg-dim);
  border-bottom: 1px solid var(--border);
  font-family: 'SF Mono', Menlo, monospace;
}

.badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: #2d1f12;
  color: #d29922;
}

.dim-badge {
  background: #161d26;
  color: var(--fg-dim);
}

.viewer-host {
  min-height: 0;
  overflow: auto;
}

.viewer-host .cm-editor {
  height: 100%;
}
```

- [ ] **Step 8: Launch and verify**

Run: `npm run dev`
Expected: clicking `package.json` shows highlighted JSON; clicking this plan file shows highlighted markdown; typing in the viewer does nothing (read-only); header shows the read-only badge.

- [ ] **Step 9: Commit**

```bash
git add packages/app
git commit -m "feat(app): read-only CodeMirror viewer with language detection (TDD on mapper)"
```

---

### Task 9: Live terminal

**Files:**
- Create: `packages/app/src/renderer/src/components/TerminalPane.tsx`
- Modify: `packages/app/src/renderer/src/App.tsx`
- Modify: `packages/app/src/renderer/src/theme.css` (append)

- [ ] **Step 1: Write `components/TerminalPane.tsx`**

```tsx
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';

export function TerminalPane() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'SF Mono', Menlo, monospace",
      cursorBlink: true,
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#1f3a5f',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    let ptyId: string | null = null;
    let offData = () => {};
    let offExit = () => {};

    window.airlock.ptyCreate(term.cols, term.rows).then((id) => {
      ptyId = id;
      offData = window.airlock.onPtyData((e) => {
        if (e.id === id) term.write(e.data);
      });
      offExit = window.airlock.onPtyExit((e) => {
        if (e.id === id) term.write('\r\n[session ended]\r\n');
      });
    });

    const input = term.onData((data) => {
      if (ptyId) window.airlock.ptyInput(ptyId, data);
    });

    const ro = new ResizeObserver(() => {
      fit.fit();
      if (ptyId) window.airlock.ptyResize(ptyId, term.cols, term.rows);
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      input.dispose();
      offData();
      offExit();
      term.dispose();
    };
  }, []);

  return <div ref={hostRef} className="terminal-host" />;
}
```

- [ ] **Step 2: Mount it in `App.tsx`, keyed by workspace root**

Full file after edit (terminal restarts in the new cwd when you open a folder):

```tsx
import { Sidebar } from './components/Sidebar';
import { TerminalPane } from './components/TerminalPane';
import { Viewer } from './components/Viewer';
import { useApp } from './store';

export function App() {
  const root = useApp((s) => s.root);
  return (
    <div className="layout">
      <Sidebar />
      <main className="editor">
        <Viewer />
      </main>
      <div className="right">
        <div className="agent-pane">
          <div className="empty">agent arrives in week 3</div>
        </div>
        <div className="terminal-slot">
          <TerminalPane key={root ?? 'no-workspace'} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Append terminal styles to `theme.css`**

```css
.terminal-host {
  height: 100%;
  padding: 6px 0 0 8px;
}
```

- [ ] **Step 4: Launch and verify the gate behaviors**

Run: `npm run dev`
Expected, in order:
1. Terminal shows your zsh prompt immediately.
2. `ls`, `git status` work; output renders with colors.
3. Open a folder → terminal restarts with `pwd` = that folder.
4. Resize the window → `echo $COLUMNS` reflects the new width.
5. `vim .gitignore` opens, edits, and quits cleanly (alternate screen works).

- [ ] **Step 5: Commit**

```bash
git add packages/app
git commit -m "feat(app): live terminal — xterm.js wired to agent-core PTY over IPC"
```

---

### Task 10: Skeleton gate — README, full check, tag

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# airlock

> Working title. A terminal-first AI IDE where the agent can build, run, and
> debug your app — but is structurally unable to read your secrets.

**Status:** walking skeleton (weeks 1–2 of the v1 roadmap). Terminal, file
tree, and read-only viewer work. Agent + secret broker land in weeks 3–5.

Spec: `docs/superpowers/specs/2026-06-03-airlock-v1-design.md`

## Dev

```bash
npm install
npm run rebuild   # rebuild node-pty for Electron's ABI
npm run dev       # launch the app
npm test          # agent-core + renderer unit tests
npm run typecheck
npm run lint
```

macOS only for now (by design — see spec §2).
```

- [ ] **Step 2: Run the full verification suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all tests pass (PTY ×4, tree ×5, read ×3, language ×8 = 20), typecheck clean, lint clean (run `npx biome check --write .` first if it complains about formatting).

- [ ] **Step 3: Manual gate checklist (spec §12, weeks 1–2 gate)**

Run: `npm run dev`, open a real project of yours (e.g. `~/cineteca`), then confirm:
- [ ] browse its tree, expand nested dirs
- [ ] view a TS/JS file with highlighting, a JSON file, a markdown file
- [ ] run its dev server from the terminal, ctrl+C it
- [ ] resize the window without breakage
- [ ] verdict: "I could live in this as my terminal" — if no, file what's missing as issues before proceeding

- [ ] **Step 4: Commit and tag**

```bash
git add -A
git commit -m "docs: README + walking-skeleton gate complete"
git tag skeleton-v0.1
```

---

## Self-review (run after writing, fixes applied inline)

1. **Spec coverage (weeks 1–2 scope):** monorepo + dependency rule (§4) → Task 1; sandboxed renderer + typed IPC (§5) → Tasks 5–6; path containment with symlink resolution (§6, brought forward) → Task 3; file tree + placeholder sidebar sections (§9) → Task 7; read-only viewer + truncation badge (§9) → Task 8; terminal (§9) → Task 9; gate (§12) → Task 10. Out of scope by design: agent, broker, redaction, audit (weeks 3–5 plan).
2. **Placeholder scan:** every code step contains complete code; no TBDs.
3. **Type consistency:** `AirlockApi` defined once in `shared/ipc.ts`, implemented in preload Task 6 Step 4, consumed via `global.d.ts`; `DirEntry`/`FileContent` originate in agent-core and are re-exported through `shared/ipc.ts`; `PtyOptions.args` added in Task 2 and used only there; `createPtySession({ cwd, cols, rows })` in Task 6 matches the optional fields.
```
