import type { LspDocumentSymbol } from "../../../shared/ipc";

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

// Derive a heading scope model from markdown text. Fence-aware (```/~~~ toggles
// suppress heading detection inside code blocks). A heading covers lines until
// the next heading of the same-or-higher level (or EOF), so headings nest the
// way VS Code's breadcrumb/sticky expect. Pure -> unit-tested.
export function scopesFromMarkdown(doc: string): Scope[] {
  const lines = doc.split("\n");
  type H = { level: number; scope: Scope };
  const heads: H[] = [];
  let offset = 0;
  let fence: string | null = null;
  lines.forEach((text, i) => {
    const lineNo = i + 1;
    const fenceMatch = text.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1]?.[0]; // ` or ~
      if (marker) {
        if (fence === null) fence = marker;
        else if (fence === marker) fence = null;
      }
    } else if (fence === null) {
      const h = text.match(/^(#{1,6})\s+(.*\S)\s*$/);
      if (h?.[1] && h[2]) {
        heads.push({
          level: h[1].length,
          scope: {
            name: h[2],
            kind: "heading",
            line: lineNo,
            endLine: lines.length, // provisional; closed below
            from: offset,
            to: doc.length,
          },
        });
      }
    }
    offset += text.length + 1; // +1 for the newline
  });
  // Close each heading at the line before the next same-or-higher-level heading.
  for (let i = 0; i < heads.length; i++) {
    const hi = heads[i];
    if (!hi) continue;
    for (let j = i + 1; j < heads.length; j++) {
      const hj = heads[j];
      if (hj && hj.level <= hi.level) {
        hi.scope.endLine = hj.scope.line - 1;
        hi.scope.to = hj.scope.from - 1;
        break;
      }
    }
  }
  return heads.map((h) => h.scope);
}

// LSP SymbolKind number -> a short display hint. Only the common ones; anything
// else falls back to "symbol".
const SYMBOL_KIND: Record<number, string> = {
  5: "class",
  6: "method",
  9: "constructor",
  11: "interface",
  12: "function",
  13: "variable",
  23: "struct",
};

// Flatten a hierarchical LspDocumentSymbol tree (already 1-based) into a flat
// nested Scope[] in document order. Pure -> unit-tested.
export function lspSymbolsToScopes(symbols: LspDocumentSymbol[]): Scope[] {
  const out: Scope[] = [];
  const walk = (nodes: LspDocumentSymbol[]): void => {
    for (const n of nodes) {
      out.push({
        name: n.name,
        kind: SYMBOL_KIND[n.kind] ?? "symbol",
        line: n.range.startLine,
        endLine: n.range.endLine,
        from: 0, // offsets unused for LSP scopes; breadcrumb/sticky use lines
        to: 0,
      });
      if (n.children.length) walk(n.children);
    }
  };
  walk(symbols);
  return out;
}
