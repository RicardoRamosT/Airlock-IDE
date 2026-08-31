// ASCII comments only. Geometry and labelling for the Atlas menu bar item.
//
// PURE -- this file imports nothing. The Electron half lives in trayWindow.ts.
// The split is deliberate: test/electron-stub.ts exports every Electron member
// as `undefined` on purpose, and its comment warns that turning them into
// working fakes silently flips main-process code onto its packaged path. So
// anything worth testing lives here, and the test imports only this file. Same
// shape the tabdrag modules already use.
//
// The item sits in the RIGHT-hand status area. The left of the macOS menu bar
// belongs to the frontmost application's menus and is not addressable by any
// API; the right-hand area is the one that stays visible whatever has focus.

export const POPOVER_WIDTH = 380;
export const POINTER_H = 10; // the bubble's little arrow
export const POPOVER_HEIGHT = 420;

// A four-point sparkle, the near-universal mark for AI. Drawn as a macOS
// TEMPLATE image: black pixels plus alpha only, which the system recolors for
// light and dark menu bars automatically. Embedded as data rather than shipped
// as a file, so the tray needs no electron-builder extraResources entry --
// adding an asset changes packaging, and packaging breaks are caught only by
// `npm run package`.
//
// A small dot beside the sparkle means "there is a debrief you have not read".
// Nothing else announces it: no notification, no sound, no focus steal.
export const TRAY_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAADW0lEQVR4nNWZPWgUQRTHf3t38SOCoIgWckRRUVCxSSNaaiEomICKTSAIKQ5sUmqrIARSSYIQSacRbTSCoCh2QnpbSUgjFn4rmuwmMvAePIbd7G5219v8YZjduZ15/3nzPmbmoB4IpLSBzWwABFI/BvaZCdQSDSHXB0TAsLS3qha8Xo20jHZXgQVgO9Cso5Y3SX1FyP6V+p6091QpfHeObwND5ijwVczBlVBIXzMr4LRdKrYCT6ROI9o07xeAz0JwxdSR1Dc9W3elEFR4vwjo99qTsBe4CywJyUhqLStmAs+BE5QEdZgxGXzMa1domDoGPDRkVJOrCWXZPM8BFykAJeEcZ1EGXZR3P44GUnYAg8ADo11Lyhar9TdABzhUhLAu+4jn4SPe70k4CbxLIK1kvwBXKQGBOMAWYF6WVYW6916TEHw0jcm4ePtI+oUe2ffAYdOnUFxWgTc8YUp61PsuDnYF3pr+jvAnyXylxGINLQeBn57jaCz9COwyK5EE1VqfxGKd8OWyyAaitcDYX5hgf6+kj36fBF2F69LvmddeCDrj2ykeHnqm0ZMx2jhTOBWTYAqR7aSQ1cCvv3cykFazGc2Z4mNhZ9sxGlwr4NsUuwqclf6V78CsgNEcZK09R8Av4JI3bhyCos6F2NbkOshaTevzpNlSpjljJjQ87zwjOTzNZrOQDs2ewI2raOXdhamN2mXaCYwb7fiha70lNBMYFzmWeG4bPw7ckWOK7zhllcgoYkHkObmZ0ZbMch/4EaONqkponr+L/EHJkGuaiNv1P/VsVHN6lYSjGJkzwOmsDun2qrdkt1W1lkPzPC9ynfxMaHgOtw0YqsiOI89+h0SeopknYvj523nwVInaXjbPU16EaJaVNJC0ulAwFi8brWqaLi15xGl8/xrHmaz2OivjVL6nUG27O4fXOUkvST1hxiv9UiQOzRjSaTatv780YxS+CMmDhiE9l0I6NMfz3rJubYpo+oBkp7iLEL21+Qbs8SbbFahNDydoWbeg573vuwol8cIjrc44433Xdeglibvo+G1MI5L3IxmO+F2z52nR6h+pp73fqZuW23Jm07Nbu47aVSipWTGJWa+9dtC9wICYw0DMXqRW0P2Au/z4YC5Bavfvjw9H8NxGIMr/xj8d1xA6CnYv5AAAAABJRU5ErkJggg==";

export function trayTitle(hasUnread: boolean): string {
  return hasUnread ? " •" : "";
}

// Anchor so the bubble's POINTER lands under the tray icon. The pointer sits
// a fixed inset from the bubble's left edge, so the bubble is offset left by
// that inset rather than centred -- centring made the panel drift away from
// the icon and read as unconnected.
export const POINTER_INSET = 22;

// How close the pointer may get to a rounded corner before it stops looking
// attached to the bubble.
const POINTER_EDGE_MARGIN = 10;

// Where to put the popover, AND where the pointer must sit inside it.
//
// pointerX is not always POINTER_INSET. The window's x is clamped to the
// display, so a WIDE panel (the popover is user-resizable) near either edge
// gets pushed sideways -- and the arrow, drawn at a fixed inset, then aimed at
// empty menu bar instead of the icon. The renderer positions it from this.
export function popoverBounds(
  trayBounds: { x: number; y: number; width: number },
  display: { x: number; width: number },
  size: { width: number; height: number },
): { x: number; y: number; pointerX: number } {
  const iconCenter = trayBounds.x + trayBounds.width / 2;
  const wanted = Math.round(iconCenter - POINTER_INSET);
  const min = display.x;
  const max = display.x + display.width - size.width;
  // max < min when the panel is wider than the display; prefer the left edge
  // over the negative x that clamping in the other order produces.
  const x = max < min ? min : Math.min(Math.max(wanted, min), max);
  const pointerX = Math.round(
    Math.min(
      Math.max(iconCenter - x, POINTER_EDGE_MARGIN),
      Math.max(POINTER_EDGE_MARGIN, size.width - POINTER_EDGE_MARGIN),
    ),
  );
  return { x, y: trayBounds.y, pointerX };
}
