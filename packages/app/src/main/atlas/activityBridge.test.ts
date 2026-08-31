import { expect, it, vi } from "vitest";
import { ATLAS_ACTIVITY_CHANNEL, activityReporter } from "./activityBridge";

const win = (over: { dead?: boolean; deadContents?: boolean } = {}) => {
  const send = vi.fn();
  return {
    isDestroyed: () => over.dead === true,
    webContents: { isDestroyed: () => over.deadContents === true, send },
    send,
  };
};

const ITEMS = [{ tool: "Bash", detail: "npm test" }];

it("delivers to every window, on the channel the preload subscribes to", () => {
  // EVERY window, not appWindows(): the Atlas popover and the standalone chat
  // window are not app windows, and they are exactly who needs this.
  const a = win();
  const b = win();
  activityReporter(() => [a, b])(ITEMS);
  expect(a.send).toHaveBeenCalledWith(ATLAS_ACTIVITY_CHANNEL, ITEMS);
  expect(b.send).toHaveBeenCalledWith(ATLAS_ACTIVITY_CHANNEL, ITEMS);
});

it("names the channel the renderer listens on", () => {
  expect(ATLAS_ACTIVITY_CHANNEL).toBe("atlas:activity");
});

it("skips a destroyed window and one with destroyed contents", () => {
  // A run outlives the window that started it -- closing the popover mid-turn
  // must not throw inside the CLI's line handler and fail the whole turn.
  const dead = win({ dead: true });
  const gutted = win({ deadContents: true });
  const alive = win();
  activityReporter(() => [dead, gutted, alive])(ITEMS);
  expect(dead.send).not.toHaveBeenCalled();
  expect(gutted.send).not.toHaveBeenCalled();
  expect(alive.send).toHaveBeenCalledTimes(1);
});

it("sends nothing for an empty batch", () => {
  const a = win();
  activityReporter(() => [a])([]);
  expect(a.send).not.toHaveBeenCalled();
});

it("reads the window list per batch, not once", () => {
  // A window opened after the run started still gets the rest of the steps.
  const a = win();
  const b = win();
  const windows = vi.fn(() => [a]);
  const report = activityReporter(() => windows());
  report(ITEMS);
  windows.mockReturnValue([a, b]);
  report(ITEMS);
  expect(a.send).toHaveBeenCalledTimes(2);
  expect(b.send).toHaveBeenCalledTimes(1);
});
