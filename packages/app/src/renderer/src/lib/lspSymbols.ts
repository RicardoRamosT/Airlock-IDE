import type { LspDocumentSymbol } from "../../../shared/ipc";

// Normalize a raw textDocument/documentSymbol result -- either DocumentSymbol[]
// (hierarchical, `.range` + `.children`) or SymbolInformation[] (flat,
// `.location.range`) -- to our LspDocumentSymbol[] with 1-based lines. Pure.
export function normalizeDocumentSymbols(raw: unknown): LspDocumentSymbol[] {
  if (!Array.isArray(raw)) return [];
  const out: LspDocumentSymbol[] = [];
  for (const node of raw) {
    if (!node || typeof node !== "object") continue;
    const n = node as Record<string, unknown>;
    const name = typeof n.name === "string" ? n.name : null;
    const kind = typeof n.kind === "number" ? n.kind : 0;
    const rangeSrc =
      n.range ??
      (n.location && typeof n.location === "object"
        ? (n.location as Record<string, unknown>).range
        : undefined);
    const range = normRange(rangeSrc);
    if (name === null || !range) continue;
    out.push({
      name,
      kind,
      range,
      children: normalizeDocumentSymbols(n.children),
    });
  }
  return out;
}

function normRange(r: unknown): LspDocumentSymbol["range"] | null {
  if (!r || typeof r !== "object") return null;
  const rr = r as { start?: unknown; end?: unknown };
  const s = pt(rr.start);
  const e = pt(rr.end);
  if (!s || !e) return null;
  return { startLine: s.line, startChar: s.ch, endLine: e.line, endChar: e.ch };
}

function pt(p: unknown): { line: number; ch: number } | null {
  if (!p || typeof p !== "object") return null;
  const pp = p as { line?: unknown; character?: unknown };
  if (typeof pp.line !== "number" || typeof pp.character !== "number")
    return null;
  return { line: pp.line + 1, ch: pp.character }; // 0-based LSP -> 1-based line
}
