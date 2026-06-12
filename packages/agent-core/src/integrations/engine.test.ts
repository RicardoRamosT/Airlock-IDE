// packages/agent-core/src/integrations/engine.test.ts
import { describe, expect, it } from "vitest";
import type { CliRunner } from "./engine";
import { runManifest } from "./engine";
import { VERCEL } from "./registry";

const LS_OUT = JSON.stringify({
  deployments: [
    { uid: "dpl_1", name: "web", url: "u1", readyState: "BUILDING", meta: { githubCommitRef: "main" } },
  ],
});

// A runner that returns "" for `whoami` (authed) and LS_OUT for `ls`.
const okRunner: CliRunner = async (_cmd, args) =>
  args[0] === "whoami" ? "" : LS_OUT;

describe("runManifest", () => {
  it("detects, polls, parses, and maps", async () => {
    const items = await runManifest(VERCEL, "/repo", okRunner);
    expect(items).toEqual([
      { id: "int:vercel:dpl_1", title: "web", subtitle: "main", state: "running", href: "u1" },
    ]);
  });

  it("returns [] when detect fails (not installed / not authed)", async () => {
    const failAuth: CliRunner = async (_c, args) => {
      if (args[0] === "whoami") throw new Error("not logged in");
      return LS_OUT;
    };
    expect(await runManifest(VERCEL, "/repo", failAuth)).toEqual([]);
  });

  it("returns [] when the poll command fails", async () => {
    const failPoll: CliRunner = async (_c, args) => {
      if (args[0] === "whoami") return "";
      throw new Error("boom");
    };
    expect(await runManifest(VERCEL, "/repo", failPoll)).toEqual([]);
  });

  it("returns [] when the output is not JSON", async () => {
    const garbage: CliRunner = async (_c, args) =>
      args[0] === "whoami" ? "" : "not json";
    expect(await runManifest(VERCEL, "/repo", garbage)).toEqual([]);
  });

  it("passes the project root as cwd for cwdScoped manifests", async () => {
    const seen: Array<{ cwd?: string }> = [];
    const spy: CliRunner = async (_c, args, opts) => {
      seen.push({ cwd: opts.cwd });
      return args[0] === "whoami" ? "" : LS_OUT;
    };
    await runManifest(VERCEL, "/repo", spy);
    expect(seen.every((s) => s.cwd === "/repo")).toBe(true);
  });
});
