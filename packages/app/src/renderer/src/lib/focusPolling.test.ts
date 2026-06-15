import { describe, expect, it } from "vitest";
import { type FocusPollingHost, startFocusPolling } from "./focusPolling";

// A DOM-free fake of the window/document seam so the focus+timer gating is
// deterministic: no real timers, no jsdom, no microtask flushing. `fireTimer`
// invokes whatever is currently scheduled (simulating the interval elapsing);
// fireFocus/fireBlur dispatch the listeners and flip hasFocus like a real WM.
function fakeHost(initiallyFocused: boolean) {
  let focused = initiallyFocused;
  let nextId = 1;
  const intervals = new Map<number, () => void>();
  const listeners: Record<"focus" | "blur", Array<() => void>> = {
    focus: [],
    blur: [],
  };
  const host: FocusPollingHost = {
    hasFocus: () => focused,
    setInterval: (fn) => {
      const id = nextId++;
      intervals.set(id, fn);
      return id;
    },
    clearInterval: (id) => void intervals.delete(id),
    addEventListener: (type, fn) => void listeners[type].push(fn),
    removeEventListener: (type, fn) => {
      listeners[type] = listeners[type].filter((f) => f !== fn);
    },
  };
  return {
    host,
    activeTimers: () => intervals.size,
    fireTimer: () => {
      for (const fn of intervals.values()) fn();
    },
    fireFocus: () => {
      focused = true;
      for (const fn of [...listeners.focus]) fn();
    },
    fireBlur: () => {
      focused = false;
      for (const fn of [...listeners.blur]) fn();
    },
  };
}

describe("startFocusPolling", () => {
  it("polls on the timer when the window starts focused (but not synchronously)", () => {
    const h = fakeHost(true);
    let ticks = 0;
    startFocusPolling(() => ticks++, 5000, h.host);
    expect(ticks).toBe(0); // caller owns the initial fetch; no synchronous tick
    expect(h.activeTimers()).toBe(1);
    h.fireTimer();
    h.fireTimer();
    expect(ticks).toBe(2);
  });

  it("does not poll while the window starts unfocused", () => {
    const h = fakeHost(false);
    let ticks = 0;
    startFocusPolling(() => ticks++, 5000, h.host);
    expect(h.activeTimers()).toBe(0);
    h.fireTimer();
    expect(ticks).toBe(0);
  });

  it("ticks immediately AND resumes the timer when focus is regained", () => {
    const h = fakeHost(false);
    let ticks = 0;
    startFocusPolling(() => ticks++, 5000, h.host);
    h.fireFocus();
    expect(ticks).toBe(1); // immediate re-probe on return, don't wait an interval
    expect(h.activeTimers()).toBe(1);
    h.fireTimer();
    expect(ticks).toBe(2);
  });

  it("pauses the timer on blur", () => {
    const h = fakeHost(true);
    let ticks = 0;
    startFocusPolling(() => ticks++, 5000, h.host);
    h.fireBlur();
    expect(h.activeTimers()).toBe(0);
    h.fireTimer();
    expect(ticks).toBe(0);
  });

  it("never stacks more than one timer across repeated focus events", () => {
    const h = fakeHost(true);
    startFocusPolling(() => {}, 5000, h.host);
    h.fireFocus();
    h.fireFocus();
    expect(h.activeTimers()).toBe(1);
  });

  it("cleanup stops the timer and detaches listeners", () => {
    const h = fakeHost(true);
    let ticks = 0;
    const cleanup = startFocusPolling(() => ticks++, 5000, h.host);
    cleanup();
    expect(h.activeTimers()).toBe(0);
    // After cleanup, focus/blur are no longer observed -> no work, no leaks.
    h.fireFocus();
    h.fireTimer();
    expect(ticks).toBe(0);
  });
});
