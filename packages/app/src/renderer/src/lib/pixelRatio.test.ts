// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { onPixelRatioChange } from "./pixelRatio";

// A matchMedia that models the ONE thing this module turns on: a
// `(resolution: Xdppx)` query matches a single ratio, and fires only when its
// OWN match state flips. So a query armed at 2dppx fires going 2 -> 2.5 and then
// stays silent for 2.5 -> 3, which is the trap onPixelRatioChange exists to
// avoid. Verified against real Chromium via an Electron probe (dpr 2 -> 2.5 -> 3
// -> 4: a re-armed listener saw all three, an un-re-armed one saw the first).
interface FakeQuery {
  ratio: number;
  matches: boolean;
  listeners: Set<() => void>;
}
let live: FakeQuery[] = [];

function installMatchMedia(ratio: number): void {
  live = [];
  window.devicePixelRatio = ratio;
  window.matchMedia = ((q: string) => {
    const m = /([\d.]+)dppx/.exec(q);
    const fake: FakeQuery = {
      ratio: m ? Number(m[1]) : Number.NaN,
      matches: m ? Number(m[1]) === window.devicePixelRatio : false,
      listeners: new Set(),
    };
    live.push(fake);
    return {
      get matches() {
        return fake.matches;
      },
      media: q,
      addEventListener: (_: string, cb: () => void) => fake.listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) =>
        fake.listeners.delete(cb),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

function setRatio(ratio: number): void {
  window.devicePixelRatio = ratio;
  // Snapshot: a handler re-arms mid-iteration, adding to `live`.
  for (const q of [...live]) {
    const matches = q.ratio === ratio;
    if (matches === q.matches) continue; // no state flip -> no event, as in Blink
    q.matches = matches;
    for (const cb of [...q.listeners]) cb();
  }
}

afterEach(() => {
  live = [];
});

it("fires on EVERY ratio change, not just the first", () => {
  installMatchMedia(2);
  const seen: number[] = [];
  const stop = onPixelRatioChange(() => seen.push(window.devicePixelRatio));

  setRatio(2.5);
  setRatio(3);
  setRatio(1);

  // The whole point: an armed-once listener would report only 2.5 here.
  expect(seen).toEqual([2.5, 3, 1]);
  stop();
});

it("stops reporting once disposed", () => {
  installMatchMedia(2);
  const cb = vi.fn();
  const stop = onPixelRatioChange(cb);
  setRatio(2.5);
  expect(cb).toHaveBeenCalledTimes(1);

  stop();
  setRatio(3);
  setRatio(2);
  expect(cb).toHaveBeenCalledTimes(1);
});

it("is a no-op where matchMedia is absent, and its disposer is safe", () => {
  // jsdom's default: no matchMedia at all. Must not throw at arm or dispose.
  (window as { matchMedia?: unknown }).matchMedia = undefined;
  const stop = onPixelRatioChange(() => {
    throw new Error("must not fire");
  });
  expect(() => stop()).not.toThrow();
});
