import { describe, expect, it } from "vitest";
import { toRendererErrorEvent } from "./rendererError";

describe("toRendererErrorEvent", () => {
  it("maps an error payload to a renderer LogEvent input", () => {
    const e = toRendererErrorEvent({
      kind: "error",
      message: "boom",
      source: "index.js",
      line: 4,
      col: 2,
      stack: "Error: boom\n  at x",
    });
    expect(e.level).toBe("error");
    expect(e.category).toBe("renderer");
    expect(e.op).toBe("renderer.error");
    expect(e.error.message).toContain("boom");
    expect(e.error.message).toContain("index.js:4");
  });
  it("maps an unhandledrejection", () => {
    expect(
      toRendererErrorEvent({ kind: "unhandledrejection", message: "nope" }).op,
    ).toBe("renderer.unhandledrejection");
  });
});
