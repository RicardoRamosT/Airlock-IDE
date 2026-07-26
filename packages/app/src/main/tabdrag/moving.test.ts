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
