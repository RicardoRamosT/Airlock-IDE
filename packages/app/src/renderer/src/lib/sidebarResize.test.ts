import { describe, expect, it } from "vitest";
import { resizeSidebar, SIDEBAR_MAX, SIDEBAR_MIN } from "./sidebarResize";

describe("resizeSidebar", () => {
  it("left dock: drag right widens", () => {
    expect(resizeSidebar(230, 50, "left")).toEqual({
      width: 280,
      collapse: false,
    });
  });

  it("right dock: drag left widens (delta is negative)", () => {
    expect(resizeSidebar(230, -50, "right")).toEqual({
      width: 280,
      collapse: false,
    });
  });

  it("clamps to the min width without collapsing", () => {
    // raw = 230 - 90 = 140 -> below MIN(160) but above the collapse threshold.
    expect(resizeSidebar(230, -90, "left")).toEqual({
      width: SIDEBAR_MIN,
      collapse: false,
    });
  });

  it("clamps to the max width", () => {
    expect(resizeSidebar(230, 1000, "left")).toEqual({
      width: SIDEBAR_MAX,
      collapse: false,
    });
  });

  it("collapses (keeping width) when dragged below the collapse threshold", () => {
    // raw = 230 - 200 = 30 -> collapse; width is preserved for re-open.
    expect(resizeSidebar(230, -200, "left")).toEqual({
      width: 230,
      collapse: true,
    });
  });
});
