import { describe, expect, it } from "vitest";
import {
  buildAuthedArgs,
  buildCredentialHelperConfig,
  credentialHelperIntact,
  runGitAuthed,
} from "./auth";

it("builds two -c flags that disable the inherited helper then supply ours", () => {
  const args = buildAuthedArgs(["push"]);
  expect(args[0]).toBe("-c");
  expect(args[1]).toBe("credential.helper="); // clears inherited helpers
  expect(args[2]).toBe("-c");
  expect(args[3]).toContain("credential.helper=");
  expect(args[3]).toContain("AIRLOCK_GH_TOKEN"); // reads token from env
  expect(args.at(-1)).toBe("push");
});

it("runs git with the token in env, never in argv", async () => {
  let seenArgs: string[] = [];
  let seenEnv: NodeJS.ProcessEnv | undefined;
  const fakeExec = async (
    args: string[],
    opts: { cwd: string; env?: NodeJS.ProcessEnv; maxBuffer: number },
  ) => {
    seenArgs = args;
    seenEnv = opts.env;
    return { stdout: "ok" };
  };
  const out = await runGitAuthed("/repo", "gho_SECRET", ["push"], fakeExec);
  expect(out).toBe("ok");
  expect(seenEnv?.AIRLOCK_GH_TOKEN).toBe("gho_SECRET");
  expect(seenArgs.join(" ")).not.toContain("gho_SECRET");
  expect(seenArgs).toContain("push");
});

describe("buildCredentialHelperConfig", () => {
  it("resets inherited helpers, then installs a host-scoped gh-token helper", () => {
    const cfg = buildCredentialHelperConfig("github.com", "octocat");
    // reset must come FIRST so the global gh helper is suppressed for this repo
    expect(cfg.set[0]).toEqual({ key: "credential.helper", value: "" });
    const scoped = cfg.set[1];
    if (!scoped) throw new Error("no scoped helper");
    expect(scoped.key).toBe("credential.https://github.com.helper");
    // the helper fetches THIS account's token via gh (no global switch)
    expect(scoped.value).toContain(
      "gh auth token --hostname github.com --user octocat",
    );
    expect(scoped.value).toContain("username=x-access-token");
    // unset targets both keys on unpin
    expect(cfg.unset).toEqual([
      "credential.helper",
      "credential.https://github.com.helper",
    ]);
  });

  it("rejects a host or username that could break out of the shell string", () => {
    expect(() =>
      buildCredentialHelperConfig("github.com", "a; rm -rf /"),
    ).toThrow();
    expect(() =>
      buildCredentialHelperConfig("evil$(x).com", "octocat"),
    ).toThrow();
  });
});

describe("credentialHelperIntact", () => {
  const host = "github.com";
  const user = "octocat";
  const ours = buildCredentialHelperConfig(host, user).set[1]?.value ?? "";
  const generic = "!/opt/homebrew/bin/gh auth git-credential";

  it("accepts a freshly-installed pin", () => {
    expect(
      credentialHelperIntact({ helper: [""], scoped: [ours] }, host, user),
    ).toBe(true);
  });

  it("rejects a pin whose scoped helper was removed (legacy pre-0.6 pin)", () => {
    expect(credentialHelperIntact({ helper: [], scoped: [] }, host, user)).toBe(
      false,
    );
  });

  it("rejects a generic gh helper standing in for ours", () => {
    // torque: scoped key holds gh's account-agnostic helper -> serves ACTIVE
    expect(
      credentialHelperIntact(
        { helper: [], scoped: ["!gh auth git-credential"] },
        host,
        user,
      ),
    ).toBe(false);
  });

  it("rejects a foreign helper appended after our reset, even when ours survives", () => {
    // Revaltone-CRM shape: the generic runs BEFORE our scoped one and wins.
    expect(
      credentialHelperIntact(
        { helper: ["", generic], scoped: [ours] },
        host,
        user,
      ),
    ).toBe(false);
  });

  it("rejects a pin belonging to a DIFFERENT account", () => {
    const other =
      buildCredentialHelperConfig(host, "hubot").set[1]?.value ?? "";
    expect(
      credentialHelperIntact({ helper: [""], scoped: [other] }, host, user),
    ).toBe(false);
  });
});
