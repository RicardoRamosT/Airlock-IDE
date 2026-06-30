// True for paths the inline PDF viewer should handle (by extension).
export function isPdfPath(relPath: string): boolean {
  const i = relPath.lastIndexOf(".");
  if (i < 0) return false;
  return relPath.slice(i + 1).toLowerCase() === "pdf";
}
