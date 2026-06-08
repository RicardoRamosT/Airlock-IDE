import { describe, expect, it } from "vitest";
import { isImagePath } from "./imageTypes";

describe("isImagePath", () => {
  it("matches raster image extensions, case-insensitively", () => {
    expect(isImagePath("a/b/photo.png")).toBe(true);
    expect(isImagePath("ICON.JPG")).toBe(true);
    expect(isImagePath("x.webp")).toBe(true);
  });
  it("rejects non-images, svg (edits as text), and extensionless", () => {
    expect(isImagePath("main.ts")).toBe(false);
    expect(isImagePath("logo.svg")).toBe(false);
    expect(isImagePath("noext")).toBe(false);
  });
});
