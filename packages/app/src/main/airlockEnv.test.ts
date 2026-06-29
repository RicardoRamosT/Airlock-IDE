import { describe, expect, it } from "vitest";
import { AIRLOCK_ENV, stampAirlockEnv } from "./airlockEnv";

describe("stampAirlockEnv", () => {
  it("adds AIRLOCK_IDE=1 as the inside-AirLock marker", () => {
    expect(stampAirlockEnv({}).AIRLOCK_IDE).toBe("1");
    expect(AIRLOCK_ENV).toEqual({ AIRLOCK_IDE: "1" });
  });
  it("preserves existing env entries and does not mutate the input", () => {
    const base = { PATH: "/usr/bin", LANG: "en_US.UTF-8" };
    const out = stampAirlockEnv(base);
    expect(out).toEqual({
      PATH: "/usr/bin",
      LANG: "en_US.UTF-8",
      AIRLOCK_IDE: "1",
    });
    expect(base).toEqual({ PATH: "/usr/bin", LANG: "en_US.UTF-8" }); // input untouched
  });
});
