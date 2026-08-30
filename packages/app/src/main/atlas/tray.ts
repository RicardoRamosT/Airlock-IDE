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

export const POPOVER_WIDTH = 360;
export const POPOVER_HEIGHT = 420;

// A filled marker means "there is a brief you have not read". Nothing else
// announces it: no notification, no sound, no focus steal.
export function trayTitle(hasUnread: boolean): string {
  return hasUnread ? "A●" : "A";
}

// Centre under the item, then clamp inside the display it is on.
export function popoverBounds(
  trayBounds: { x: number; y: number; width: number },
  display: { x: number; width: number },
  size: { width: number; height: number },
): { x: number; y: number } {
  const centred = Math.round(
    trayBounds.x + trayBounds.width / 2 - size.width / 2,
  );
  const min = display.x;
  const max = display.x + display.width - size.width;
  return { x: Math.min(Math.max(centred, min), max), y: trayBounds.y };
}
