import { describe, expect, it } from "vitest";
import { hintBounds, hintHtml } from "./cursorHint";

// A 1440x900 display whose work area starts below the menu bar.
const area = { x: 0, y: 25, width: 1440, height: 875 };
const size = { width: 420, height: 34 };

describe("hintBounds", () => {
  it("sits below-right of the cursor, clear of the pointer itself", () => {
    const b = hintBounds({ x: 300, y: 400 }, area, size);
    expect(b).toEqual({ x: 316, y: 420, width: 420, height: 34 });
  });

  it("flips to the LEFT of the cursor near the right edge", () => {
    const b = hintBounds({ x: 1430, y: 400 }, area, size);
    expect(b.x).toBe(1430 - 16 - 420);
    expect(b.x + b.width).toBeLessThanOrEqual(area.x + area.width);
  });

  it("flips ABOVE the cursor near the bottom edge", () => {
    const b = hintBounds({ x: 300, y: 895 }, area, size);
    expect(b.y).toBe(895 - 20 - 34);
    expect(b.y + b.height).toBeLessThanOrEqual(area.y + area.height);
  });

  it("stays on the work area even in the corner (flip plus clamp)", () => {
    const b = hintBounds({ x: 1439, y: 899 }, area, size);
    expect(b.x).toBeGreaterThanOrEqual(area.x);
    expect(b.y).toBeGreaterThanOrEqual(area.y);
    expect(b.x + b.width).toBeLessThanOrEqual(area.x + area.width);
    expect(b.y + b.height).toBeLessThanOrEqual(area.y + area.height);
  });

  it("respects a display that is not at the origin (second monitor)", () => {
    const second = { x: -1920, y: 0, width: 1920, height: 1080 };
    const b = hintBounds({ x: -100, y: 500 }, second, size);
    expect(b.x).toBeGreaterThanOrEqual(second.x);
    expect(b.x + b.width).toBeLessThanOrEqual(second.x + second.width);
  });

  it("returns integer bounds (Electron wants whole pixels)", () => {
    const b = hintBounds({ x: 300.7, y: 400.2 }, area, size);
    expect(Number.isInteger(b.x)).toBe(true);
    expect(Number.isInteger(b.y)).toBe(true);
  });
});

describe("hintHtml", () => {
  it("includes the message", () => {
    expect(hintHtml("Release to open Airlock in a new window")).toContain(
      "Release to open Airlock in a new window",
    );
  });

  it("escapes the text -- a project name is a folder name and can contain anything", () => {
    const html = hintHtml('Release <img src=x onerror="boom">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&quot;");
  });

  it("draws on a transparent page so only the chip is visible", () => {
    const html = hintHtml("hi");
    expect(html).toContain("background:transparent");
    expect(html).toContain('class="chip"');
  });
});
