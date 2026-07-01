import { describe, expect, it } from "vitest";
import { isExcelPath } from "./excelTypes";

describe("isExcelPath", () => {
  it("matches excel extensions case-insensitively", () => {
    for (const p of ["a.xlsx", "b.XLS", "c.xlsm"])
      expect(isExcelPath(p)).toBe(true);
  });
  it("rejects others", () => {
    for (const p of ["a.pdf", "a.csv", "README", "x.xlsx.txt"])
      expect(isExcelPath(p)).toBe(false);
  });
});
