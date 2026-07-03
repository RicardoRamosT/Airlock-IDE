import { describe, expect, it } from "vitest";
import { awaitCallback, resolveCallback } from "./deeplink";

describe("deeplink pending-flow registry", () => {
  it("resolves the awaiting promise for a matching state", async () => {
    const p = awaitCallback("S1", 1000);
    expect(resolveCallback("airlock://oauth/slack?ticket=T1&state=S1")).toBe(
      true,
    );
    await expect(p).resolves.toEqual({ ticket: "T1" });
  });

  it("does not resolve for a wrong or absent state (the CSRF guard)", async () => {
    let settled = false;
    const p = awaitCallback("S2", 1000).then(() => {
      settled = true;
    });
    expect(resolveCallback("airlock://oauth/slack?ticket=T&state=OTHER")).toBe(
      false,
    );
    expect(resolveCallback("airlock://oauth/slack?ticket=T")).toBe(false); // no state
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveCallback("airlock://oauth/slack?ticket=T&state=S2"); // clean up the timer
    await p;
  });

  it("is a no-op on a second callback for a consumed state", async () => {
    const p = awaitCallback("S3", 1000);
    expect(resolveCallback("airlock://oauth/x?ticket=A&state=S3")).toBe(true);
    await expect(p).resolves.toEqual({ ticket: "A" });
    expect(resolveCallback("airlock://oauth/x?ticket=B&state=S3")).toBe(false);
  });

  it("returns false for a non-airlock or malformed url", () => {
    expect(resolveCallback("https://evil.example/?state=S&ticket=T")).toBe(
      false,
    );
    expect(resolveCallback("not a url")).toBe(false);
  });
});
