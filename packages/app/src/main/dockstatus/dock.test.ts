import path from "node:path";
import { describe, expect, it } from "vitest";
import { dockVariantPath } from "./dock";

describe("dockVariantPath", () => {
  it("maps each state to its icon file", () => {
    const d = "/icons";
    expect(dockVariantPath("working", d)).toBe(path.join(d, "working.png"));
    expect(dockVariantPath("done", d)).toBe(path.join(d, "done.png"));
    expect(dockVariantPath("idle", d)).toBe(path.join(d, "idle.png"));
  });
});
