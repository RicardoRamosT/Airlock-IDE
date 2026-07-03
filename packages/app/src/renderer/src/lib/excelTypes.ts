// True for paths the inline Excel viewer should handle (by extension).
const EXCEL_EXTS = new Set(["xlsx", "xls", "xlsm"]);
export function isExcelPath(relPath: string): boolean {
  const i = relPath.lastIndexOf(".");
  if (i < 0) return false;
  return EXCEL_EXTS.has(relPath.slice(i + 1).toLowerCase());
}
