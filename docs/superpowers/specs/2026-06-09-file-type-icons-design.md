# File-type icons in the file explorer

**Date:** 2026-06-09
**Status:** Approved by owner (approach A confirmed via Q&A). Branch
feat/file-type-icons.

VS Code-style per-type icons in the Files tree (owner supplied a Seti-theme
screenshot as the reference): a colored glyph or two-letter badge per file
type instead of today's single generic `codicon-file`.

## Approach (chosen: A)

Hand-rolled mapping — **colored codicons + colored two-letter text badges**
("TS", "JS"), no new dependencies. Rejected: B) shipping an icon-theme SVG
package (megabyte-class assets, licensing review, build plumbing) and C)
color-only tinting of the generic glyph (barely informative).

## Units

| Unit | Responsibility |
| --- | --- |
| `lib/fileIcons.ts` (**new**, pure) | `fileIconFor(name: string): FileIcon` where `FileIcon = { kind: "codicon"; icon: string; color?: string } \| { kind: "badge"; text: string; color: string }`. Match order: exact filename → compound suffix → extension → default (`codicon-file`, no color). Case-insensitive. |
| `components/FileIcon.tsx` (**new**, thin) | `<FileIcon name="x.ts" />` renders the codicon `<i>` (inline color) or a `<span class="file-icon-badge">` with the badge text/color. |
| `FileTree.tsx` | The one file-row glyph (`<i className="codicon codicon-file" />`) becomes `<FileIcon name={name} />`. |
| `MainTabs.tsx` | The file TAB glyph (same generic icon) becomes `<FileIcon name={fileName(p)} />` — consistency for free. |
| `theme.css` | `.file-icon-badge`: fixed 16px slot, ~9px bold colored text (VS Code badges are colored text, per the reference); light-theme override for the JS yellow. Codicon glyphs keep their 16px slot so rows don't shift. |

## Mapping (initial set)

- Exact names: `dockerfile`/`docker-compose.yml` → `codicon-vm` blue;
  `package.json`/`package-lock.json` → `codicon-json` green; `.gitignore`/
  `.gitattributes` → `codicon-source-control` orange; `claude.md` →
  `codicon-sparkle`(fallback `codicon-markdown`) violet.
- Compound suffixes: `.test.*`/`.spec.*` → `codicon-beaker` green;
  `.config.{ts,js,mjs,cjs}` → `codicon-gear` gray.
- Extensions: `ts`/`tsx` → badge "TS" #3178c6 (tsx slightly lighter);
  `js`/`mjs`/`cjs` → badge "JS" yellow; `jsx` → badge "JS" cyan; `json`/
  `jsonc` → `codicon-json` yellow; `md` → `codicon-markdown` blue; `html` →
  `codicon-code` orange; `css`/`scss`/`less` → badge "#" blue/pink; `svg`/
  `png`/`jpg`/`jpeg`/`gif`/`webp`/`ico` → `codicon-file-media` purple;
  `pdf` → `codicon-file-pdf` red; `zip`/`gz`/`tar` → `codicon-file-zip`;
  `env`(+ `.env.*` names) → `codicon-lock` yellow; `lock` → `codicon-lock`
  gray; `sh`/`zsh`/`bash` → `codicon-terminal` green; `py` → badge "PY"
  blue; `rb` → `codicon-ruby` red; `go` → badge "GO" cyan; `rs` → badge
  "RS" orange; `sql`/`db` → `codicon-database` blue; `yml`/`yaml`/`toml` →
  `codicon-settings` gray; anything else → `codicon-file` default dim.
- Codicon existence is verified at implementation time against the shipped
  `@vscode/codicons` css; absent names fall back per-entry as noted.

## Error handling / edge cases

- Unknown extension, extension-less files, dotfiles without a rule → default
  generic icon (today's look).
- Match on the basename only (callers pass names; tree rows and tab labels
  already have them).
- Directories are untouched (chevron + name as today).

## Testing

- Pure mapping tests (`lib/fileIcons.test.ts`): exact-name beats extension
  (`package.json` ≠ plain json), compound beats extension (`x.test.ts` ≠
  "TS"), case-insensitivity (`README.MD`), `.env.local`, unknown → default.
- Components stay untested (thin wiring, repo convention); existing FileTree
  suites must stay green.

## Out of scope

- An icon-theme dependency, folder-specific icons, user-configurable
  mappings, icons anywhere beyond the tree + file tabs.
