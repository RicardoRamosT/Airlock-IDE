import { describe, expect, it } from "vitest";
import { isExternalFileDrag } from "./externalDrop";

describe("isExternalFileDrag", () => {
  it("is true when the drag carries OS files", () => {
    expect(isExternalFileDrag(["Files"])).toBe(true);
    expect(isExternalFileDrag(["text/plain", "Files"])).toBe(true);
  });
  it("is false for an internal move drag (text/plain only)", () => {
    expect(isExternalFileDrag(["text/plain"])).toBe(false);
    expect(isExternalFileDrag([])).toBe(false);
  });
});
