import { describe, expect, it } from "vitest";
import { isPdfPath } from "./pdfTypes";

describe("isPdfPath", () => {
  it("matches .pdf case-insensitively", () => {
    expect(isPdfPath("docs/ElArqui_Propuesta.pdf")).toBe(true);
    expect(isPdfPath("A.PDF")).toBe(true);
  });
  it("rejects non-pdf and extensionless paths", () => {
    expect(isPdfPath("a.png")).toBe(false);
    expect(isPdfPath("README")).toBe(false);
    expect(isPdfPath("notes.pdf.txt")).toBe(false);
  });
});
