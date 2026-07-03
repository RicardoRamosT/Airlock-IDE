import { describe, expect, it } from "vitest";
import { randomState } from "./state";

describe("randomState", () => {
  it("is URL-safe and at least 32 chars", () => {
    const s = randomState();
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBeGreaterThanOrEqual(32);
  });

  it("is unique across calls", () => {
    expect(randomState()).not.toBe(randomState());
  });

  it("is deterministic with an injected RNG", () => {
    const bytes = new Uint8Array(24).map((_, i) => i + 1);
    expect(randomState(() => bytes)).toBe(
      Buffer.from(bytes).toString("base64url"),
    );
  });
});
