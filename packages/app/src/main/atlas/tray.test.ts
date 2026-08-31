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

it("keeps the POINTER on the icon when the panel is clamped to an edge", () => {
  // The bug: the arrow is drawn at a fixed POINTER_INSET from the window's left
  // edge, which only aims at the icon while x is UNCLAMPED. A wide panel near
  // the right edge gets pushed left, and the arrow then points at empty menu
  // bar -- a long way from the icon, which is what makes the bubble stop
  // reading as connected to it.
  const tray = { x: 1200, y: 24, width: 30 };
  const at = popoverBounds(
    tray,
    { x: 0, width: 1440 },
    {
      width: 900,
      height: 420,
    },
  );
  expect(at.x).toBe(540); // clamped: 1440 - 900
  // The pointer must still land on the icon's centre (1215), i.e. 675 into the
  // window -- not the fixed 22.
  expect(at.x + at.pointerX).toBe(1215);
});

it("keeps the pointer inside the bubble's rounded corners", () => {
  // An icon at the very left would otherwise put the arrow off the corner.
  const at = popoverBounds(
    { x: 0, y: 24, width: 4 },
    { x: 0, width: 1440 },
    {
      width: 380,
      height: 420,
    },
  );
  expect(at.pointerX).toBeGreaterThanOrEqual(10);
  expect(at.pointerX).toBeLessThanOrEqual(370);
});

it("never places the window off-screen when it is wider than the display", () => {
  // Reachable: the popover is user-resizable, so the panel can exceed a small
  // display. max < min made the clamp return a negative x.
  const at = popoverBounds(
    { x: 700, y: 24, width: 30 },
    { x: 0, width: 800 },
    {
      width: 1000,
      height: 420,
    },
  );
  expect(at.x).toBe(0);
});
