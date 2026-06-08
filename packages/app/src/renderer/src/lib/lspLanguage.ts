// Map a file extension to its LSP languageId, or null when not an LSP-handled
// language (slice 1: TypeScript/JavaScript only).
const LANG: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascriptreact",
};

export function lspLanguageId(relPath: string): string | null {
  const i = relPath.lastIndexOf(".");
  if (i < 0) return null;
  return LANG[relPath.slice(i + 1).toLowerCase()] ?? null;
}
