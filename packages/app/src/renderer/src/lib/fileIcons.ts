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

const ENV_ICON = codicon("lock", "var(--ficon-env)");

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
  env: ENV_ICON,
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
  if (n === ".env" || n.startsWith(".env.")) return ENV_ICON;
  if (/\.(test|spec)\.[^.]+$/.test(n))
    return codicon("beaker", "var(--ficon-test)");
  if (/\.config\.(ts|js|mjs|cjs)$/.test(n))
    return codicon("gear", "var(--ficon-conf)");
  const dot = n.lastIndexOf(".");
  if (dot <= 0) return DEFAULT_ICON; // extension-less or pure dotfile
  return EXT[n.slice(dot + 1)] ?? DEFAULT_ICON;
}
