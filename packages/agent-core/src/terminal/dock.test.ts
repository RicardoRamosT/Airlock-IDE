import { describe, expect, it } from "vitest";
import {
  dockVisibility,
  hideWindowScript,
  paneScreenRect,
  setFrameScript,
} from "./dock";

describe("paneScreenRect", () => {
  it("offsets the DOM rect by the window content origin (rounded)", () => {
    expect(
      paneScreenRect(
        { x: 100, y: 80, width: 1400, height: 900 },
        { left: 220.4, top: 48.6, width: 900.2, height: 700.7 },
      ),
    ).toEqual({ x: 320, y: 129, width: 900, height: 701 });
  });
  it("handles a negative (secondary-display) origin", () => {
    expect(
      paneScreenRect(
        { x: -1920, y: 0, width: 1000, height: 800 },
        { left: 60, top: 40, width: 500, height: 400 },
      ),
    ).toEqual({ x: -1860, y: 40, width: 500, height: 400 });
  });
});

describe("dockVisibility", () => {
  const base = {
    paneShown: true,
    windowVisible: true,
    overlayActive: false,
    dragging: false,
  };
  it("shows only when shown + visible + no overlay + not dragging", () => {
    expect(dockVisibility(base)).toBe("show");
  });
  it("hides on pane-not-shown, window-hidden, overlay, or drag", () => {
    expect(dockVisibility({ ...base, paneShown: false })).toBe("hide");
    expect(dockVisibility({ ...base, windowVisible: false })).toBe("hide");
    expect(dockVisibility({ ...base, overlayActive: true })).toBe("hide");
    expect(dockVisibility({ ...base, dragging: true })).toBe("hide");
  });
});

describe("osascript builders", () => {
  it("setFrameScript sets position + size of window 1 of the AX process", () => {
    const s = setFrameScript("Ghostty", {
      x: 200,
      y: 150,
      width: 900,
      height: 600,
    });
    expect(s).toContain('process "Ghostty"');
    expect(s).toContain("set position of window 1 to {200, 150}");
    expect(s).toContain("set size of window 1 to {900, 600}");
  });
  it("hideWindowScript moves window 1 far off-screen", () => {
    const s = hideWindowScript("Ghostty");
    expect(s).toContain('process "Ghostty"');
    expect(s).toContain("set position of window 1 to {-32000, -32000}");
  });
});
