// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LOADING_DELAY_MS, Loading } from "./Loading";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

// A spinner that appears and vanishes inside 80ms is visual noise -- it reads
// as a glitch, not as progress. Every surface that mounts this has a warm-cache
// path that resolves in single-digit milliseconds, so the delay is what keeps
// the common case looking instant instead of flickering.
it("shows nothing at all until the delay has passed", () => {
  const { container } = render(<Loading label="Loading extensions" />);
  expect(container.textContent).toBe("");
  expect(screen.queryByRole("status")).toBeNull();
});

it("appears once the delay passes", () => {
  render(<Loading label="Loading extensions" />);
  advance(LOADING_DELAY_MS);
  expect(screen.getByRole("status")).toBeTruthy();
});

// The state must be ANNOUNCED, not merely drawn: a spinning glyph is invisible
// to a screen reader, and this is the only thing on screen while it shows.
it("carries an accessible label naming what is loading", () => {
  render(<Loading label="Loading extensions" />);
  advance(LOADING_DELAY_MS);
  expect(screen.getByRole("status").getAttribute("aria-label")).toBe(
    "Loading extensions",
  );
});

// Reduced motion turns the ANIMATION off (in CSS), never the element: the user
// still needs to learn that something is loading. So the markup is identical
// either way -- there is no JS branch that could drop it.
it("renders the spinner element regardless, leaving motion to CSS", () => {
  const { container } = render(<Loading label="Loading" />);
  advance(LOADING_DELAY_MS);
  expect(container.querySelector(".loading-spinner")).toBeTruthy();
});

// The region reserves height so a pane does not collapse to spinner-height and
// then jerk open when content lands. It does not REMOVE the jump -- only a
// skeleton does that -- it bounds it.
it("reserves page height when asked, and section height by default", () => {
  const { container: section } = render(<Loading label="a" />);
  advance(LOADING_DELAY_MS);
  expect(section.querySelector(".loading.page")).toBeNull();

  cleanup();
  const { container: page } = render(<Loading label="b" size="page" />);
  advance(LOADING_DELAY_MS);
  expect(page.querySelector(".loading.page")).toBeTruthy();
});

// Unmounting before the delay fires must not leave a timer that calls setState
// on a dead component -- these mount and unmount on every sidebar view switch.
it("cancels its timer when unmounted before the delay", () => {
  const { unmount } = render(<Loading label="a" />);
  unmount();
  expect(() => advance(LOADING_DELAY_MS * 2)).not.toThrow();
});
