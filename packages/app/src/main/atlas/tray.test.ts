import { expect, it } from "vitest";
import { popoverBounds, trayTitle } from "./tray";

it("shows a filled marker only when there is an unread brief", () => {
  // The pointer is a dot and nothing else: no notification, no sound, no
  // window stealing focus (spec section 7).
  expect(trayTitle(true)).not.toBe(trayTitle(false));
  expect(trayTitle(true).length).toBeLessThanOrEqual(4);
  expect(trayTitle(false).length).toBeLessThanOrEqual(4);
});

it("centres the popover under the tray item", () => {
  const at = popoverBounds(
    { x: 500, y: 24, width: 30 },
    { x: 0, width: 1440 },
    { width: 360, height: 420 },
  );
  expect(at.x).toBe(500 + 15 - 180);
  expect(at.y).toBe(24);
});

it("keeps the popover on screen at the right edge", () => {
  // The menu bar item can sit within 20px of the corner.
  const at = popoverBounds(
    { x: 1420, y: 24, width: 30 },
    { x: 0, width: 1440 },
    { width: 360, height: 420 },
  );
  expect(at.x + 360).toBeLessThanOrEqual(1440);
});

it("keeps the popover on screen at the left edge", () => {
  const at = popoverBounds(
    { x: 2, y: 24, width: 30 },
    { x: 0, width: 1440 },
    { width: 360, height: 420 },
  );
  expect(at.x).toBeGreaterThanOrEqual(0);
});

it("respects a display that does not start at x = 0", () => {
  // A second monitor to the right of the primary has a positive origin.
  const at = popoverBounds(
    { x: 2000, y: 24, width: 30 },
    { x: 1440, width: 1920 },
    { width: 360, height: 420 },
  );
  expect(at.x).toBeGreaterThanOrEqual(1440);
  expect(at.x + 360).toBeLessThanOrEqual(1440 + 1920);
});
