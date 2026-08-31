import { describe, expect, it } from "vitest";
import { MovingSessions } from "./moving";

describe("MovingSessions", () => {
  it("claims a marked id exactly once (single-use ticket)", () => {
    const m = new MovingSessions();
    m.mark(["a", "b"]);
    expect(m.claim("a")).toBe(true);
    expect(m.claim("a")).toBe(false); // already claimed
    expect(m.claim("b")).toBe(true);
  });

  it("refuses an id that was never marked", () => {
    const m = new MovingSessions();
    expect(m.claim("never-marked")).toBe(false);
  });

  it("ignores nulls when marking (a pane may have no pty yet)", () => {
    const m = new MovingSessions();
    m.mark(["a", null]);
    expect(m.size()).toBe(1);
  });

  it("forget drops a pending id (source pane died mid-move)", () => {
    const m = new MovingSessions();
    m.mark(["a"]);
    m.forget("a");
    expect(m.claim("a")).toBe(false);
  });
});

it("has() reports a moving session WITHOUT spending its ticket", () => {
  // The window-close reaper asks this to avoid killing a pty that tear-off is
  // deliberately keeping alive. If it consumed the ticket, the adopting window
  // would then be refused and the terminal would be lost anyway -- the exact
  // outcome the exemption exists to prevent.
  const m = new MovingSessions();
  m.mark(["a", "b"]);
  expect(m.has("a")).toBe(true);
  expect(m.has("a")).toBe(true); // still there
  expect(m.size()).toBe(2);
  expect(m.claim("a")).toBe(true); // the adopt still gets it
  expect(m.has("a")).toBe(false);
});

it("has() is false for a session that was never marked", () => {
  const m = new MovingSessions();
  expect(m.has("nope")).toBe(false);
});
