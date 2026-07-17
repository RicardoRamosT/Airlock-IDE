// The shared "scope model": a flat list of nesting ranges (functions, classes,
// markdown headings, ...) that both the symbol breadcrumb and sticky scroll
// consume. Pure and unit-tested; providers are added in later tasks
// (scopesFromMarkdown here, lspSymbolsToScopes here, normalizer in lspSymbols.ts).
// Containment is a pure LINE check via endLine -- no offsets needed.
export interface Scope {
  name: string;
  kind: string; // "class" | "function" | "heading" | ... (display hint only)
  line: number; // 1-based head line
  endLine: number; // 1-based last line the scope covers (>= line)
  from: number; // start offset (used by nav/scrollIntoView; 0 for LSP scopes)
  to: number; // end offset
}

// The outer->inner chain of scopes covering a 1-based line (line within
// [line, endLine]). Ordered outermost first; ties (same head) put the wider
// scope first. Used by BOTH the breadcrumb (cursor line) and sticky scroll
// (top visible line).
export function enclosingScopes(scopes: Scope[], line: number): Scope[] {
  return scopes
    .filter((s) => line >= s.line && line <= s.endLine)
    .sort((a, b) => a.line - b.line || b.endLine - a.endLine);
}

// Split a workspace-relative path into non-empty display segments.
export function pathSegments(relPath: string): string[] {
  return relPath.split("/").filter((seg) => seg.length > 0);
}
