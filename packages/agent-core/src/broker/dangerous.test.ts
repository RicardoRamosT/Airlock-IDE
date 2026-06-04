import { describe, expect, it } from "vitest";
import { filterDangerousEnv } from "./dangerous";

describe("filterDangerousEnv", () => {
  it("strips loader-hijack and path-control names", () => {
    const { safe, blocked } = filterDangerousEnv({
      PATH: "/evil",
      DYLD_INSERT_LIBRARIES: "/evil.dylib",
      LD_PRELOAD: "/evil.so",
      NODE_OPTIONS: "--require evil",
      DATABASE_URL: "ok",
    });
    expect(safe).toEqual({ DATABASE_URL: "ok" });
    expect(blocked.sort()).toEqual([
      "DYLD_INSERT_LIBRARIES",
      "LD_PRELOAD",
      "NODE_OPTIONS",
      "PATH",
    ]);
  });

  it("blocks any DYLD_/LD_ prefixed name", () => {
    const { blocked } = filterDangerousEnv({
      DYLD_LIBRARY_PATH: "x",
      LD_AUDIT: "y",
    });
    expect(blocked.sort()).toEqual(["DYLD_LIBRARY_PATH", "LD_AUDIT"]);
  });

  it("passes ordinary names through untouched", () => {
    const env = { ANTHROPIC_API_KEY: "k", SNOWFLAKE_PASSWORD: "p" };
    expect(filterDangerousEnv(env)).toEqual({ safe: env, blocked: [] });
  });
});
