import { expect, it } from "vitest";
import { POINTER_INSET, popoverBounds, trayTitle } from "./tray";

it("shows a filled marker only when there is an unread brief", () => {
  // The pointer is a dot and nothing else: no notification, no sound, no
  // window stealing focus (spec section 7).
  expect(trayTitle(true)).not.toBe(trayTitle(false));
  expect(trayTitle(true).length).toBeLessThanOrEqual(4);
  expect(trayTitle(false).length).toBeLessThanOrEqual(4);
});

it("puts the bubble's pointer under the tray item", () => {
  // Centring drifted the panel away from the icon; the POINTER is what has to
  // line up for the bubble to read as connected.
  const at = popoverBounds(
    { x: 500, y: 24, width: 30 },
    { x: 0, width: 1440 },
    { width: 380, height: 420 },
  );
  expect(at.x + POINTER_INSET).toBe(515);
  expect(at.y).toBe(24);
});

it("keeps the popover on screen at the right edge", () => {
  // The menu bar item can sit within 20px of the corner.
  const at = popoverBounds(
    { x: 1420, y: 24, width: 30 },
    { x: 0, width: 1440 },
    { width: 380, height: 420 },
  );
  expect(at.x + 380).toBeLessThanOrEqual(1440);
});

it("keeps the popover on screen at the left edge", () => {
  const at = popoverBounds(
    { x: 2, y: 24, width: 30 },
    { x: 0, width: 1440 },
    { width: 380, height: 420 },
  );
  expect(at.x).toBeGreaterThanOrEqual(0);
});

it("respects a display that does not start at x = 0", () => {
  // A second monitor to the right of the primary has a positive origin.
  const at = popoverBounds(
    { x: 2000, y: 24, width: 30 },
    { x: 1440, width: 1920 },
    { width: 380, height: 420 },
  );
  expect(at.x).toBeGreaterThanOrEqual(1440);
  expect(at.x + 380).toBeLessThanOrEqual(1440 + 1920);
});
