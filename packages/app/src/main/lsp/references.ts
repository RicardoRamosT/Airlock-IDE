// Pure helpers for textDocument/references. parseReferences normalizes the
// LSP reply (an array of Location { uri, range }) to every target's uri +
// 0-indexed line/character, dropping malformed entries. extractLines pulls the
// source line texts for the snippet column. Both pure + total. ASCII-only
// (bundled into the CJS main).
export interface RawRef {
  uri: string;
  line: number;
  character: number;
}

export function parseReferences(result: unknown): RawRef[] {
  if (!Array.isArray(result)) return [];
  const out: RawRef[] = [];
  for (const item of result) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.uri !== "string") continue;
    const range = o.range as
      | { start?: { line?: unknown; character?: unknown } }
      | undefined;
    const line = range?.start?.line;
    if (typeof line !== "number") continue;
    const character = range?.start?.character;
    out.push({
      uri: o.uri,
      line,
      character: typeof character === "number" ? character : 0,
    });
  }
  return out;
}

export function extractLines(
  content: string,
  lines: number[],
): Map<number, string> {
  const all = content.split(/\r?\n/);
  const map = new Map<number, string>();
  for (const n of lines) {
    const text = all[n];
    if (typeof text === "string") map.set(n, text.trim());
  }
  return map;
}
