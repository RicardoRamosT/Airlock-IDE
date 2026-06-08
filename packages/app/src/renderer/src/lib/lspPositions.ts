// Inverse of slice 1's offset mapping: a character offset in `text` -> the LSP
// { line, character } position. Clamped to the document.
export function positionAt(
  text: string,
  offset: number,
): { line: number; character: number } {
  const o = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < o; i++) {
    if (text[i] === "\n") {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, character: o - lineStart };
}
