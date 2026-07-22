import { afterEach, expect, it, vi } from "vitest";

// The release build (no env) must compile the dev-update flag to false so the
// local-update code is dead-code-eliminated; package:dev (=1) compiles it true.
async function loadFlag(env: string | undefined): Promise<unknown> {
  vi.resetModules();
  if (env === undefined) delete process.env.AIRLOCK_DEV_UPDATE;
  else process.env.AIRLOCK_DEV_UPDATE = env;
  const mod = (await import("../../../electron.vite.config")) as {
    default: { main: { define: Record<string, string> } };
  };
  return mod.default.main.define.__AIRLOCK_DEV_UPDATE__;
}

afterEach(() => {
  delete process.env.AIRLOCK_DEV_UPDATE;
});

it("release build (no env) compiles the dev-update flag to false", async () => {
  expect(await loadFlag(undefined)).toBe("false");
});
it("package:dev (AIRLOCK_DEV_UPDATE=1) compiles the flag to true", async () => {
  expect(await loadFlag("1")).toBe("true");
});
