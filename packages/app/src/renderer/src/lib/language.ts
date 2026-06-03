export type LanguageKey = "js" | "json" | "md" | "css" | "html";

const BY_EXT: Record<string, LanguageKey> = {
  js: "js",
  jsx: "js",
  ts: "js",
  tsx: "js",
  mjs: "js",
  cjs: "js",
  json: "json",
  md: "md",
  markdown: "md",
  css: "css",
  html: "html",
  htm: "html",
};

export function languageKeyForPath(path: string): LanguageKey | null {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  // <= 0 (not === -1) intentionally rejects leading-dot names like ".env" too
  if (dot <= 0) return null;
  return BY_EXT[name.slice(dot + 1).toLowerCase()] ?? null;
}
