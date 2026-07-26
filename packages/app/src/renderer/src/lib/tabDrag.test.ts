import { describe, expect, it } from "vitest";
import { isMovableKey } from "./tabDrag";

describe("isMovableKey", () => {
  it("allows a normal project tab", () => {
    expect(isMovableKey("proj-2")).toBe(true);
  });

  it("refuses the split pair and the IDE page-tabs", () => {
    // A pair-tab covers TWO projects; page-tabs are app chrome. Neither moves.
    expect(isMovableKey("pair")).toBe(false);
    expect(isMovableKey("page:settings")).toBe(false);
    expect(isMovableKey("page:usage")).toBe(false);
  });
});
