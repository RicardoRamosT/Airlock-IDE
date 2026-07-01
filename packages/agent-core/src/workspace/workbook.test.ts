import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { readWorkbook } from "./workbook";

let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "wb-"));
  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet("Alpha");
  s1.getCell("A1").value = "Head";
  s1.getCell("A1").font = { bold: true, color: { argb: "FFFF0000" } };
  s1.getCell("B1").value = 42;
  s1.getCell("A2").value = "merged";
  s1.mergeCells("A2:B2");
  s1.getColumn(1).width = 20;
  wb.addWorksheet("Beta");
  await wb.xlsx.writeFile(join(dir, "book.xlsx"));
});

describe("readWorkbook", () => {
  it("maps values, bold, font color, merges, sheets", async () => {
    const d = await readWorkbook(dir, "book.xlsx");
    expect(d.tooLarge).toBe(false);
    expect(d.sheets.map((s) => s.name)).toEqual(["Alpha", "Beta"]);
    const a = d.sheets[0]!;
    expect(a.rows[0]![0]).toMatchObject({
      value: "Head",
      bold: true,
      color: "#FF0000",
    });
    expect(a.rows[0]![1]?.value).toBe("42");
    // merge anchor spans 2 cols; covered cell is null
    expect(a.rows[1]![0]?.colspan).toBe(2);
    expect(a.rows[1]![1]).toBeNull();
    expect(a.colWidths.length).toBeGreaterThanOrEqual(2);
  });

  it("flags too-large", async () => {
    const d = await readWorkbook(dir, "book.xlsx", 10);
    expect(d).toEqual({ sheets: [], tooLarge: true });
  });
});
