import { describe, expect, it } from "vitest";
import { lspLanguageId } from "./lspLanguage";

describe("lspLanguageId", () => {
  it("maps TS/JS extensions", () => {
    expect(lspLanguageId("a/b.ts")).toBe("typescript");
    expect(lspLanguageId("C.TSX")).toBe("typescriptreact");
    expect(lspLanguageId("x.js")).toBe("javascript");
    expect(lspLanguageId("y.jsx")).toBe("javascriptreact");
  });
  it("returns null for non-LSP files", () => {
    expect(lspLanguageId("readme.md")).toBeNull();
    expect(lspLanguageId("data.json")).toBeNull();
    expect(lspLanguageId("noext")).toBeNull();
  });
});
