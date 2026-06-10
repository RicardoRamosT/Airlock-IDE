# File-Type Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VS Code-style per-type icons (colored codicons + TS/JS text badges) in the Files tree and file tabs.

**Architecture:** Pure `lib/fileIcons.ts` mapping (exact name → compound suffix → extension → default) returns a `FileIcon` union; a thin `components/FileIcon.tsx` renders it; the two generic `codicon-file` sites swap to it. Colors are `var(--ficon-*)` tokens so the light theme can override.

**Tech Stack:** codicons (shipped), vitest for the pure mapping, theme.css vars.

**Spec:** `docs/superpowers/specs/2026-06-09-file-type-icons-design.md`. Commit per task; never push.

---

### Task 1: Pure mapping (`fileIconFor`)

**Files:**
- Create: `packages/app/src/renderer/src/lib/fileIcons.ts`
- Create: `packages/app/src/renderer/src/lib/fileIcons.test.ts`

- [ ] **Step 1.1: Failing tests** — create `fileIcons.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fileIconFor } from "./fileIcons";

describe("fileIconFor", () => {
  it("maps TypeScript/JavaScript to text badges", () => {
    expect(fileIconFor("store.ts")).toEqual({
      kind: "badge",
      text: "TS",
      color: "var(--ficon-ts)",
    });
    expect(fileIconFor("index.js")).toMatchObject({ text: "JS" });
  });

  it("exact names beat extensions", () => {
    expect(fileIconFor("package.json")).toMatchObject({
      icon: "json",
      color: "var(--ficon-pkg)",
    });
    expect(fileIconFor("data.json")).toMatchObject({
      icon: "json",
      color: "var(--ficon-json)",
    });
    expect(fileIconFor("CLAUDE.md")).toMatchObject({ icon: "sparkle" });
    expect(fileIconFor("notes.md")).toMatchObject({ icon: "markdown" });
  });

  it("compound suffixes beat extensions", () => {
    expect(fileIconFor("quota.test.ts")).toMatchObject({ icon: "beaker" });
    expect(fileIconFor("parse.spec.js")).toMatchObject({ icon: "beaker" });
    expect(fileIconFor("vite.config.ts")).toMatchObject({ icon: "gear" });
  });

  it("is case-insensitive", () => {
    expect(fileIconFor("README.MD")).toMatchObject({ icon: "markdown" });
    expect(fileIconFor("Dockerfile")).toMatchObject({ icon: "vm" });
  });

  it("locks .env and its variants", () => {
    expect(fileIconFor(".env")).toMatchObject({ icon: "lock" });
    expect(fileIconFor(".env.local")).toMatchObject({ icon: "lock" });
    expect(fileIconFor(".environment")).toEqual({
      kind: "codicon",
      icon: "file",
    });
  });

  it("falls back to the generic file icon", () => {
    expect(fileIconFor("LICENSE")).toEqual({ kind: "codicon", icon: "file" });
    expect(fileIconFor("weird.xyz")).toEqual({ kind: "codicon", icon: "file" });
  });
});
```

- [ ] **Step 1.2: RED** — `npx vitest run packages/app/src/renderer/src/lib/fileIcons.test.ts` → module not found.

- [ ] **Step 1.3: Implement** — create `fileIcons.ts`:

```ts
// Per-type glyph for a file name: a codicon (optionally colored) or a VS
// Code-style two-letter text badge. Colors are var(--ficon-*) tokens defined
// in theme.css so the light palette can override them. Match order: exact
// filename, .env family, compound suffix (.test/.spec/.config), extension,
// generic fallback. Pure + total: any input yields an icon.
export type FileIcon =
  | { kind: "codicon"; icon: string; color?: string }
  | { kind: "badge"; text: string; color: string };

const DEFAULT_ICON: FileIcon = { kind: "codicon", icon: "file" };

const codicon = (icon: string, color?: string): FileIcon =>
  color ? { kind: "codicon", icon, color } : { kind: "codicon", icon };
const badge = (text: string, color: string): FileIcon => ({
  kind: "badge",
  text,
  color,
});

const EXACT: Record<string, FileIcon> = {
  dockerfile: codicon("vm", "var(--ficon-vm)"),
  "docker-compose.yml": codicon("vm", "var(--ficon-vm)"),
  "docker-compose.yaml": codicon("vm", "var(--ficon-vm)"),
  "package.json": codicon("json", "var(--ficon-pkg)"),
  "package-lock.json": codicon("json", "var(--ficon-pkg)"),
  ".gitignore": codicon("source-control", "var(--ficon-git)"),
  ".gitattributes": codicon("source-control", "var(--ficon-git)"),
  "claude.md": codicon("sparkle", "var(--ficon-claude)"),
};

const EXT: Record<string, FileIcon> = {
  ts: badge("TS", "var(--ficon-ts)"),
  tsx: badge("TS", "var(--ficon-tsx)"),
  js: badge("JS", "var(--ficon-js)"),
  mjs: badge("JS", "var(--ficon-js)"),
  cjs: badge("JS", "var(--ficon-js)"),
  jsx: badge("JS", "var(--ficon-jsx)"),
  json: codicon("json", "var(--ficon-json)"),
  jsonc: codicon("json", "var(--ficon-json)"),
  md: codicon("markdown", "var(--ficon-md)"),
  html: codicon("code", "var(--ficon-html)"),
  htm: codicon("code", "var(--ficon-html)"),
  css: badge("#", "var(--ficon-css)"),
  scss: badge("#", "var(--ficon-scss)"),
  less: badge("#", "var(--ficon-scss)"),
  svg: codicon("file-media", "var(--ficon-img)"),
  png: codicon("file-media", "var(--ficon-img)"),
  jpg: codicon("file-media", "var(--ficon-img)"),
  jpeg: codicon("file-media", "var(--ficon-img)"),
  gif: codicon("file-media", "var(--ficon-img)"),
  webp: codicon("file-media", "var(--ficon-img)"),
  ico: codicon("file-media", "var(--ficon-img)"),
  pdf: codicon("file-pdf", "var(--ficon-pdf)"),
  zip: codicon("file-zip"),
  gz: codicon("file-zip"),
  tar: codicon("file-zip"),
  tgz: codicon("file-zip"),
  env: codicon("lock", "var(--ficon-env)"),
  lock: codicon("lock", "var(--ficon-conf)"),
  sh: codicon("terminal", "var(--ficon-shell)"),
  zsh: codicon("terminal", "var(--ficon-shell)"),
  bash: codicon("terminal", "var(--ficon-shell)"),
  py: badge("PY", "var(--ficon-py)"),
  rb: codicon("ruby", "var(--ficon-rb)"),
  go: badge("GO", "var(--ficon-go)"),
  rs: badge("RS", "var(--ficon-rs)"),
  sql: codicon("database", "var(--ficon-db)"),
  db: codicon("database", "var(--ficon-db)"),
  sqlite: codicon("database", "var(--ficon-db)"),
  yml: codicon("settings", "var(--ficon-conf)"),
  yaml: codicon("settings", "var(--ficon-conf)"),
  toml: codicon("settings", "var(--ficon-conf)"),
  ini: codicon("settings", "var(--ficon-conf)"),
};

export function fileIconFor(name: string): FileIcon {
  const n = name.toLowerCase();
  const exact = EXACT[n];
  if (exact) return exact;
  if (n === ".env" || n.startsWith(".env.")) return EXT.env;
  if (/\.(test|spec)\.[^.]+$/.test(n))
    return codicon("beaker", "var(--ficon-test)");
  if (/\.config\.(ts|js|mjs|cjs)$/.test(n))
    return codicon("gear", "var(--ficon-conf)");
  const dot = n.lastIndexOf(".");
  if (dot <= 0) return DEFAULT_ICON; // extension-less or pure dotfile
  return EXT[n.slice(dot + 1)] ?? DEFAULT_ICON;
}
```

- [ ] **Step 1.4: GREEN** — same vitest command → 6 tests pass.
- [ ] **Step 1.5: Commit** — `git add ...lib/fileIcons.ts ...lib/fileIcons.test.ts && git commit -m "feat(ui): pure file-type icon mapping (codicons + text badges)"`

---

### Task 2: FileIcon component + swaps + CSS

**Files:**
- Create: `packages/app/src/renderer/src/components/FileIcon.tsx`
- Modify: `packages/app/src/renderer/src/components/FileTree.tsx` (line ~303)
- Modify: `packages/app/src/renderer/src/components/MainTabs.tsx` (renderFileTab)
- Modify: `packages/app/src/renderer/src/theme.css` (`--ficon-*` vars + `.file-icon-badge`)

- [ ] **Step 2.1: Component** — create `FileIcon.tsx`:

```tsx
import { fileIconFor } from "../lib/fileIcons";

// Per-type glyph for a FILE row/tab: a colored codicon or a VS Code-style
// two-letter badge. Unknown types render the classic generic file icon, in
// the same 16px slot, so rows never shift.
export function FileIcon({ name }: { name: string }) {
  const fi = fileIconFor(name);
  if (fi.kind === "badge") {
    return (
      <span className="file-icon-badge" style={{ color: fi.color }} aria-hidden>
        {fi.text}
      </span>
    );
  }
  return (
    <i
      className={`codicon codicon-${fi.icon}`}
      style={fi.color ? { color: fi.color } : undefined}
    />
  );
}
```

- [ ] **Step 2.2: Swap sites** — in `FileTree.tsx`, the file row's `<i className="codicon codicon-file" />` becomes `<FileIcon name={name} />` (+ import). In `MainTabs.tsx` `renderFileTab`, `<i className="codicon codicon-file" />` becomes `<FileIcon name={fileName(p)} />` (+ import).

- [ ] **Step 2.3: CSS** — in `theme.css`, add to `:root` (after `--accent-glow`):

```css
  /* File-type icon palette (Seti-ish). Badge text + codicon tints. */
  --ficon-ts: #3178c6;
  --ficon-tsx: #5fb0e8;
  --ficon-js: #e0c341;
  --ficon-jsx: #44b9d6;
  --ficon-json: #cbcb41;
  --ficon-pkg: #3ba776;
  --ficon-md: #519aba;
  --ficon-html: #e37933;
  --ficon-css: #519aba;
  --ficon-scss: #f55385;
  --ficon-img: #a074c4;
  --ficon-pdf: #cc3e44;
  --ficon-env: #c6a93f;
  --ficon-git: #e37933;
  --ficon-test: #3ba776;
  --ficon-shell: #3ba776;
  --ficon-py: #519aba;
  --ficon-rb: #cc3e44;
  --ficon-go: #44b9d6;
  --ficon-rs: #c98a4b;
  --ficon-db: #519aba;
  --ficon-conf: #8b949e;
  --ficon-claude: #b180d7;
  --ficon-vm: #519aba;
```

to `:root[data-theme="light"]` (yellows need darkening on white):

```css
  --ficon-js: #b7a512;
  --ficon-json: #9a9a2f;
  --ficon-env: #9a8526;
  --ficon-conf: #6e7781;
```

and a badge rule near `.file-icon` usage sites (after `.sidebar-view-body`):

```css
/* Two-letter file-type badge ("TS"): colored text in the same fixed slot a
   codicon occupies, so tree rows and tab labels align identically. */
.file-icon-badge {
  flex: none;
  width: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
```

- [ ] **Step 2.4: Gates** — `npm test && npm run typecheck && npm run lint` (FileTree suites must stay green; biome `--write` for import order if flagged).
- [ ] **Step 2.5: Commit** — `git add -A packages/app/src/renderer && git commit -m "feat(ui): per-type file icons in the tree and file tabs"`

---

## Self-review notes

- Spec coverage: mapping table (T1), match order incl. `.environment` non-match (T1 test), component + both swap sites + 16px slot (T2), theme override (T2 CSS), fallback look (T1+T2). All codicon names verified present in the shipped font during spec writing.
- Type consistency: `FileIcon` union + `fileIconFor` used identically in both tasks.
