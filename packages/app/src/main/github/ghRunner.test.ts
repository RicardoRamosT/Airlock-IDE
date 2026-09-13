import { describe, expect, it } from "vitest";
import { type GhRunnerDeps, ghRunnerFor } from "./ghRunner";

function deps(over: Partial<GhRunnerDeps> = {}): GhRunnerDeps {
  return {
    readPin: async () => "RicardoRamosT",
    token: async () => "gho_secret",
    exec: async () => "[]",
    ...over,
  };
}

describe("ghRunnerFor", () => {
  it("passes the pinned account's token in the child env, never in argv", async () => {
    let seenArgs: string[] = [];
    let seenEnv: NodeJS.ProcessEnv = {};
    const gh = await ghRunnerFor(
      "/p",
      deps({
        exec: async (args, _cwd, env) => {
          seenArgs = args;
          seenEnv = env;
          return "[]";
        },
      }),
    );
    await gh.run(["pr", "list"], "/p");
    expect(seenEnv.GH_TOKEN).toBe("gho_secret");
    expect(seenArgs.join(" ")).not.toContain("gho_secret");
    expect(gh.account).toBe("RicardoRamosT");
    expect(gh.degraded).toBeNull();
  });

  it("runs unpinned when the project has no pin", async () => {
    let seenEnv: NodeJS.ProcessEnv = {};
    const gh = await ghRunnerFor(
      "/p",
      deps({
        readPin: async () => null,
        exec: async (_a, _c, env) => {
          seenEnv = env;
          return "[]";
        },
      }),
    );
    await gh.run(["pr", "list"], "/p");
    expect("GH_TOKEN" in seenEnv).toBe(false);
    expect(gh.account).toBeNull();
    expect(gh.degraded).toBeNull();
  });

  it("reports a reason when the pinned token cannot be resolved", async () => {
    // The failure that must never be silent: the pin exists, the token does
    // not, so gh falls back to the ACTIVE account and returns someone else's
    // view of the world -- or an empty list that looks like "nothing here".
    const gh = await ghRunnerFor(
      "/p",
      deps({
        token: async () => {
          throw new Error("not logged in");
        },
      }),
    );
    expect(gh.degraded).toContain("RicardoRamosT");
    expect(gh.account).toBeNull();
  });

  it("never puts the token in the degraded reason", async () => {
    const gh = await ghRunnerFor(
      "/p",
      deps({
        token: async () => {
          throw new Error("boom gho_secret boom");
        },
      }),
    );
    expect(gh.degraded ?? "").not.toContain("gho_secret");
  });
});
