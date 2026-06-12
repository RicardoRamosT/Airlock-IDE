// packages/agent-core/src/integrations/engine.test.ts
import { describe, expect, it } from "vitest";
import type { CliRunner } from "./engine";
import {
  detectStatus,
  isCommandMissing,
  type PollCache,
  pollIntegrations,
  pollSteady,
  runManifest,
  type SteadyCache,
  steadyView,
} from "./engine";
import type { IntegrationManifest } from "./manifest";
import { VERCEL } from "./registry";

const LS_OUT = JSON.stringify({
  deployments: [
    {
      uid: "dpl_1",
      name: "web",
      url: "u1",
      readyState: "BUILDING",
      meta: { githubCommitRef: "main" },
    },
  ],
});

// A runner that returns "" for `whoami` (authed) and LS_OUT for `ls`.
const okRunner: CliRunner = async (_cmd, args) =>
  args[0] === "whoami" ? "" : LS_OUT;

describe("runManifest", () => {
  it("detects, polls, parses, and maps", async () => {
    const items = await runManifest(VERCEL, "/repo", okRunner);
    expect(items).toEqual([
      {
        id: "int:vercel:dpl_1",
        title: "web",
        subtitle: "main",
        state: "running",
        href: "u1",
      },
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

  it("treats a null root as no cwd for a cwdScoped manifest", async () => {
    const seen: Array<string | undefined> = [];
    const spy: CliRunner = async (_cmd, args, opts) => {
      seen.push(opts.cwd);
      return args[0] === "whoami" ? "" : LS_OUT;
    };
    const items = await runManifest(VERCEL, null, spy);
    expect(seen.every((c) => c === undefined)).toBe(true); // null root -> no cwd
    expect(items).toEqual([
      {
        id: "int:vercel:dpl_1",
        title: "web",
        subtitle: "main",
        state: "running",
        href: "u1",
      },
    ]);
  });
});

describe("steadyView + transient/steady split", () => {
  const steadyManifest: IntegrationManifest = {
    id: "steady-x",
    name: "SteadyX",
    surface: { view: "databases" },
    detect: { authCheck: { cmd: "x", args: ["whoami"] } },
    poll: { everyMs: 1000, cli: { cmd: "x", args: ["ls", "--json"] } },
    map: { title: "$.name", state: { from: "$.s", default: "idle" } },
  };

  it("steadyView returns the target view for steady manifests, null for transient", () => {
    expect(steadyView(steadyManifest)).toBe("databases");
    expect(steadyView(VERCEL)).toBeNull(); // VERCEL has no surface -> transient
  });

  it("pollIntegrations ignores steady manifests (it only feeds the Activity feed)", async () => {
    const run: CliRunner = async () => {
      throw new Error("should not be polled");
    };
    const out = await pollIntegrations(
      [steadyManifest],
      "/repo",
      1000,
      {},
      run,
    );
    expect(out).toEqual([]);
  });
});

describe("detectStatus", () => {
  const m = VERCEL; // any manifest; we only exercise its detect.authCheck
  it("ready when the auth check exits 0", async () => {
    const run: CliRunner = async () => "";
    expect(await detectStatus(m, undefined, 8000, run)).toBe("ready");
  });
  it("absent when the binary is missing (ENOENT)", async () => {
    const run: CliRunner = async () => {
      throw Object.assign(new Error("not found"), { code: "ENOENT" });
    };
    expect(await detectStatus(m, undefined, 8000, run)).toBe("absent");
  });
  it("unauthed when the auth check runs but fails (non-ENOENT)", async () => {
    const run: CliRunner = async () => {
      throw Object.assign(new Error("not logged in"), { code: 1 });
    };
    expect(await detectStatus(m, undefined, 8000, run)).toBe("unauthed");
  });
  it("isCommandMissing only matches ENOENT", () => {
    expect(isCommandMissing({ code: "ENOENT" })).toBe(true);
    expect(isCommandMissing({ code: 1 })).toBe(false);
    expect(isCommandMissing(null)).toBe(false);
    expect(isCommandMissing(new Error("x"))).toBe(false);
  });
});

describe("pollIntegrations", () => {
  const counting = () => {
    let polls = 0;
    const run: CliRunner = async (_cmd, args) => {
      if (args[0] !== "whoami") polls++;
      return args[0] === "whoami" ? "" : LS_OUT;
    };
    return { run, polls: () => polls };
  };

  it("honors everyMs: serves cache within the window, re-runs after it", async () => {
    const { run, polls } = counting();
    const cache: PollCache = {};
    const first = await pollIntegrations([VERCEL], "/repo", 1000, cache, run);
    expect(first).toHaveLength(1);
    expect(polls()).toBe(1);

    // 5s later: within VERCEL's everyMs (20000) -> cached, no new spawn.
    const second = await pollIntegrations([VERCEL], "/repo", 6000, cache, run);
    expect(second).toEqual(first);
    expect(polls()).toBe(1);

    // 25s after the first run: past everyMs -> re-runs.
    await pollIntegrations([VERCEL], "/repo", 26000, cache, run);
    expect(polls()).toBe(2);
  });
});

describe("pollSteady", () => {
  // A steady manifest whose probe returns a 2-element JSON array.
  const PROBE = JSON.stringify([
    { name: "W1", state: "STARTED", size: "X-Small" },
    { name: "W2", state: "SUSPENDED", size: "Small" },
  ]);
  const steadyM: IntegrationManifest = {
    id: "wh",
    name: "Warehouses",
    surface: { view: "databases" },
    detect: { authCheck: { cmd: "wh", args: ["test"] } },
    poll: { everyMs: 30000, cli: { cmd: "wh", args: ["ls", "--json"] } },
    map: {
      items: "$",
      key: "$.name",
      title: "$.name",
      subtitle: "$.size",
      state: {
        from: "$.state",
        running: ["STARTED", "RESUMING"],
        default: "idle",
      },
      show: ["running", "idle", "done", "failed"],
    },
  };

  it("returns a ready integration with one resource per item", async () => {
    const run: CliRunner = async (_c, args) =>
      args[0] === "test" ? "" : PROBE;
    const [s] = await pollSteady([steadyM], null, 1000, {}, run);
    expect(s).toEqual({
      id: "wh",
      name: "Warehouses",
      view: "databases",
      status: "ready",
      resources: [
        { id: "int:wh:W1", title: "W1", subtitle: "X-Small", state: "running" },
        { id: "int:wh:W2", title: "W2", subtitle: "Small", state: "idle" },
      ],
    });
  });

  it("returns absent (no resources) when the binary is missing", async () => {
    const run: CliRunner = async () => {
      throw Object.assign(new Error("nope"), { code: "ENOENT" });
    };
    const [s] = await pollSteady([steadyM], null, 1000, {}, run);
    expect(s).toMatchObject({ status: "absent", resources: [] });
  });

  it("stays ready with no rows when authed but the probe fails", async () => {
    const run: CliRunner = async (_c, args) => {
      if (args[0] === "test") return ""; // authed
      throw new Error("query failed");
    };
    const [s] = await pollSteady([steadyM], null, 1000, {}, run);
    expect(s).toMatchObject({ status: "ready", resources: [] });
  });

  it("honors everyMs: serves cache within the window", async () => {
    let polls = 0;
    const run: CliRunner = async (_c, args) => {
      if (args[0] !== "test") polls++;
      return args[0] === "test" ? "" : PROBE;
    };
    const cache: SteadyCache = {};
    await pollSteady([steadyM], null, 1000, cache, run);
    await pollSteady([steadyM], null, 1000 + 5000, cache, run); // within 30000
    expect(polls).toBe(1);
  });

  it("ignores transient (Activity) manifests", async () => {
    const run: CliRunner = async () => "";
    expect(await pollSteady([VERCEL], null, 1000, {}, run)).toEqual([]);
  });
});
