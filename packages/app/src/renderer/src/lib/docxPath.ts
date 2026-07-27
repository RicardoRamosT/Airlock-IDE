// True for paths the inline document viewer should handle (by extension).
// .doc (the old binary format) is deliberately absent: the reader opens the
// OOXML zip only, and claiming support would give a blank page instead of the
// binary notice that at least offers to open it elsewhere.
//
// (This replaced docxHtml.ts, which sanitised a mammoth HTML string into React.
// The reader now returns a structured model instead of markup, so there is no
// HTML to sanitise -- only this path test survived.)
const DOC_EXTS = new Set(["docx"]);
export function isDocxPath(relPath: string): boolean {
  const i = relPath.lastIndexOf(".");
  if (i < 0) return false;
  return DOC_EXTS.has(relPath.slice(i + 1).toLowerCase());
}
