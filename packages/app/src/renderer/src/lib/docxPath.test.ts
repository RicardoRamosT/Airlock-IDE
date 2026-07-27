import { describe, expect, it } from "vitest";
import { isDocxPath } from "./docxPath";

describe("isDocxPath", () => {
  it("matches .docx regardless of case", () => {
    expect(isDocxPath("notes/Spec.DOCX")).toBe(true);
    expect(isDocxPath("a.docx")).toBe(true);
  });
  it("does NOT claim .doc -- the reader opens the OOXML zip only", () => {
    expect(isDocxPath("old.doc")).toBe(false);
    expect(isDocxPath("README")).toBe(false);
    expect(isDocxPath("a.docx.zip")).toBe(false);
  });
});
