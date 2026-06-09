import { expect, it } from "vitest";
import { buildAuthedArgs, runGitAuthed } from "./auth";

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
