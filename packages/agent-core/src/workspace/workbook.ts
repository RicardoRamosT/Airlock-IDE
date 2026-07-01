// Parse an .xlsx workbook into a plain WorkbookData for the renderer.
// ExcelJS runs in main only; the renderer receives WorkbookData over IPC.
// ASCII-only file.
import { stat } from "node:fs/promises";
import ExcelJS from "exceljs";
import { resolveWithin, targetsVault } from "./tree";

export type ExcelAlign = "left" | "center" | "right";

export interface ExcelCell {
  value: string;
  bold?: boolean;
  italic?: boolean;
  color?: string; // "#RRGGBB"
  fill?: string; // "#RRGGBB"
  align?: ExcelAlign;
  colspan?: number;
  rowspan?: number;
}

export interface ExcelSheet {
  name: string;
  rows: (ExcelCell | null)[][];
  colWidths: number[];
}

export interface WorkbookData {
  sheets: ExcelSheet[];
  tooLarge: boolean;
}

// An 8-hex ARGB string e.g. "FFFF0000". Theme/indexed colors are objects
// without a plain hex .argb string and are intentionally omitted.
const ARGB_RE = /^[0-9A-Fa-f]{8}$/;

function argbToHex(argb: unknown): string | undefined {
  if (typeof argb !== "string" || !ARGB_RE.test(argb)) return undefined;
  return "#" + argb.slice(2).toUpperCase();
}

// Parse a cell reference like "A1" into 0-based {row, col}.
function parseCellRef(ref: string): { row: number; col: number } | null {
  const m = ref.match(/^([A-Z]+)(\d+)$/i);
  if (!m || !m[1] || !m[2]) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, col: col - 1 };
}

// Parse a range like "A2:B3" into anchor + covered coords.
function parseRange(range: string): {
  anchorRow: number;
  anchorCol: number;
  endRow: number;
  endCol: number;
} | null {
  const colon = range.indexOf(":");
  if (colon < 0) return null;
  const a = parseCellRef(range.slice(0, colon));
  const b = parseCellRef(range.slice(colon + 1));
  if (!a || !b) return null;
  return { anchorRow: a.row, anchorCol: a.col, endRow: b.row, endCol: b.col };
}

export async function readWorkbook(
  root: string,
  relPath: string,
  max = 15_000_000,
): Promise<WorkbookData> {
  if (targetsVault(relPath))
    throw new Error("The .airlock folder is protected");
  const abs = await resolveWithin(root, relPath);
  const { size } = await stat(abs);
  if (size > max) return { sheets: [], tooLarge: true };

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(abs);

  const sheets: ExcelSheet[] = [];

  for (const ws of wb.worksheets) {
    // Column widths: default 8.43 chars -> px approximation.
    const cols = ws.columns ?? [];
    const colWidths = cols.map((c) => Math.round((c.width ?? 8.43) * 7 + 5));

    // Build merge maps: anchor -> {colspan, rowspan}; covered = set of "r,c".
    const anchorSpan: Record<string, { colspan: number; rowspan: number }> = {};
    const covered = new Set<string>();
    const merges: string[] = (ws.model as { merges?: string[] }).merges ?? [];
    for (const range of merges) {
      const parsed = parseRange(range);
      if (!parsed) continue;
      const { anchorRow, anchorCol, endRow, endCol } = parsed;
      anchorSpan[`${anchorRow},${anchorCol}`] = {
        colspan: endCol - anchorCol + 1,
        rowspan: endRow - anchorRow + 1,
      };
      for (let r = anchorRow; r <= endRow; r++) {
        for (let c = anchorCol; c <= endCol; c++) {
          if (r === anchorRow && c === anchorCol) continue; // anchor itself
          covered.add(`${r},${c}`);
        }
      }
    }

    const rows: (ExcelCell | null)[][] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const rowCells: (ExcelCell | null)[] = [];
      for (let c = 1; c <= ws.columnCount; c++) {
        const rIdx = r - 1;
        const cIdx = c - 1;
        const key = `${rIdx},${cIdx}`;
        if (covered.has(key)) {
          rowCells.push(null);
          continue;
        }
        const cell = row.getCell(c);
        const value =
          cell.text !== undefined && cell.text !== ""
            ? cell.text
            : String(cell.value ?? "");

        const cellObj: ExcelCell = { value };

        if (cell.font?.bold) cellObj.bold = true;
        if (cell.font?.italic) cellObj.italic = true;

        const fontColor = argbToHex(cell.font?.color?.argb);
        if (fontColor) cellObj.color = fontColor;

        const fillType = (cell.fill as { type?: string } | undefined)?.type;
        const fillPattern = (cell.fill as { pattern?: string } | undefined)
          ?.pattern;
        const fillArgb = (
          cell.fill as { fgColor?: { argb?: unknown } } | undefined
        )?.fgColor?.argb;
        if (fillType === "pattern" && fillPattern === "solid") {
          const fillColor = argbToHex(fillArgb);
          if (fillColor) cellObj.fill = fillColor;
        }

        const horiz = (cell.alignment as { horizontal?: string } | undefined)
          ?.horizontal;
        if (horiz === "left" || horiz === "center" || horiz === "right") {
          cellObj.align = horiz;
        }

        const span = anchorSpan[key];
        if (span) {
          if (span.colspan > 1) cellObj.colspan = span.colspan;
          if (span.rowspan > 1) cellObj.rowspan = span.rowspan;
        }

        rowCells.push(cellObj);
      }
      rows.push(rowCells);
    }

    sheets.push({ name: ws.name, rows, colWidths });
  }

  return { sheets, tooLarge: false };
}
