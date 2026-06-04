import { describe, expect, it } from "vitest";
import { captureLoginEnv, loginShell } from "./login-env";

describe("loginShell", () => {
  it("returns an absolute shell path", () => {
    const s = loginShell();
    expect(s.startsWith("/")).toBe(true);
  });
});

describe("captureLoginEnv", () => {
  it("captures PATH and HOME from the login shell", async () => {
    const env = await captureLoginEnv();
    // A login shell always has PATH and HOME; if capture failed it returns {},
    // which would fail this assertion and correctly signal a broken capture.
    expect(env.PATH).toBeTruthy();
    expect(env.HOME).toBeTruthy();
  }, 10_000);

  it("only includes valid env var names", async () => {
    const env = await captureLoginEnv();
    for (const key of Object.keys(env)) {
      expect(key).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    }
  }, 10_000);
});
