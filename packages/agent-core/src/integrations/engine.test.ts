// packages/agent-core/src/integrations/engine.test.ts
import { describe, expect, it } from "vitest";
import type { CliRunner } from "./engine";
import {
  detectStatus,
  detectWithOutput,
  isCommandMissing,
  isRelevant,
  type PollCache,
  parseAccount,
  pollIntegrations,
  pollSteady,
  runManifest,
  type SteadyCache,
  type SteadyIntegration,
  steadyIntegrationFor,
  steadyView,
} from "./engine";
import type { IntegrationManifest } from "./manifest";

// A LOCAL fixture manifest, not a shipped one. These tests exercise the ENGINE,
// so binding them to whichever integrations happen to be in the registry made
// them break when Vercel (their previous stand-in) was removed. Shape mirrors a
// deploy CLI: activity-surfaced, an auth check, a JSON list poll.
const DEPLOY: IntegrationManifest = {
  id: "deploycli",
  name: "DeployCLI",
  icon: "rocket",
  surface: "activity",
  detect: { authCheck: { cmd: "deploycli", args: ["whoami"] } },
  poll: {
    everyMs: 20000,
    cwdScoped: true,
    cli: { cmd: "deploycli", args: ["ls", "--json"] },
  },
  map: {
    items: "$.deployments",
    key: "$.uid",
    title: "$.name",
    subtitle: "$.meta.githubCommitRef",
    href: "$.url",
    state: {
      from: "$.readyState",
      running: ["BUILDING", "QUEUED", "INITIALIZING"],
      done: ["READY"],
      failed: ["ERROR", "CANCELED"],
      default: "idle",
    },
  },
};

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
    const items = await runManifest(DEPLOY, "/repo", okRunner);
    expect(items).toEqual([
      {
        id: "int:deploycli:dpl_1",
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
    expect(await runManifest(DEPLOY, "/repo", failAuth)).toEqual([]);
  });

  it("returns [] when the poll command fails", async () => {
    const failPoll: CliRunner = async (_c, args) => {
      if (args[0] === "whoami") return "";
      throw new Error("boom");
    };
    expect(await runManifest(DEPLOY, "/repo", failPoll)).toEqual([]);
  });

  it("returns [] when the output is not JSON", async () => {
    const garbage: CliRunner = async (_c, args) =>
      args[0] === "whoami" ? "" : "not json";
    expect(await runManifest(DEPLOY, "/repo", garbage)).toEqual([]);
  });

  it("passes the project root as cwd for cwdScoped manifests", async () => {
    const seen: Array<{ cwd?: string }> = [];
    const spy: CliRunner = async (_c, args, opts) => {
      seen.push({ cwd: opts.cwd });
      return args[0] === "whoami" ? "" : LS_OUT;
    };
    await runManifest(DEPLOY, "/repo", spy);
    expect(seen.every((s) => s.cwd === "/repo")).toBe(true);
  });

  it("treats a null root as no cwd for a cwdScoped manifest", async () => {
    const seen: Array<string | undefined> = [];
    const spy: CliRunner = async (_cmd, args, opts) => {
      seen.push(opts.cwd);
      return args[0] === "whoami" ? "" : LS_OUT;
    };
    const items = await runManifest(DEPLOY, null, spy);
    expect(seen.every((c) => c === undefined)).toBe(true); // null root -> no cwd
    expect(items).toEqual([
      {
        id: "int:deploycli:dpl_1",
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
    expect(steadyView(DEPLOY)).toBeNull(); // an activity surface is not a steady VIEW
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
  const m = DEPLOY; // any manifest; we only exercise its detect.authCheck
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
    const first = await pollIntegrations([DEPLOY], "/repo", 1000, cache, run);
    expect(first).toHaveLength(1);
    expect(polls()).toBe(1);

    // 5s later: within DEPLOY's everyMs (20000) -> cached, no new spawn.
    const second = await pollIntegrations([DEPLOY], "/repo", 6000, cache, run);
    expect(second).toEqual(first);
    expect(polls()).toBe(1);

    // 25s after the first run: past everyMs -> re-runs.
    await pollIntegrations([DEPLOY], "/repo", 26000, cache, run);
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

  it("carries the manifest's install + connect commands into the steady result", async () => {
    const m: IntegrationManifest = {
      ...steadyM,
      install: { command: "brew install wh" },
      connect: { command: "wh auth" },
    };
    const run: CliRunner = async () => {
      throw Object.assign(new Error("nope"), { code: "ENOENT" }); // absent
    };
    const [s] = await pollSteady([m], null, 1000, {}, run);
    expect(s?.install).toEqual({ command: "brew install wh" });
    expect(s?.connect).toEqual({ command: "wh auth" });
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
    expect(await pollSteady([DEPLOY], null, 1000, {}, run)).toEqual([]);
  });

  it("surfaces unauthed (no resources) when authed check fails but binary exists", async () => {
    const run: CliRunner = async (_c, args) => {
      if (args[0] === "test")
        throw Object.assign(new Error("not logged in"), { code: 1 });
      return PROBE; // unreachable: detect fails first
    };
    const [s] = await pollSteady([steadyM], null, 1000, {}, run);
    expect(s).toMatchObject({ status: "unauthed", resources: [] });
  });
});

describe("steadyIntegrationFor", () => {
  const steadyM: IntegrationManifest = {
    id: "wh2",
    name: "Warehouses2",
    surface: { view: "databases" },
    detect: { authCheck: { cmd: "wh", args: ["test"] } },
    poll: { everyMs: 30000, cli: { cmd: "wh", args: ["ls", "--json"] } },
    map: {
      items: "$",
      key: "$.name",
      title: "$.name",
      state: { from: "$.state", default: "idle" },
    },
  };

  it("returns the same shape pollSteady would, for a steady-view manifest", async () => {
    const run: CliRunner = async (_c, args) =>
      args[0] === "test" ? "" : JSON.stringify([{ name: "W1", state: "idle" }]);
    const value = await steadyIntegrationFor(steadyM, null, 1000, {}, run);
    expect(value).toMatchObject({
      id: "wh2",
      view: "databases",
      status: "ready",
    });
  });

  // This is the actual bug behind CRITICAL #1: the integrations:resources IPC
  // handler used to call pollSteady([m], ...) for a single by-id lookup too,
  // and pollSteady EXCLUDES any manifest whose surface is not a steady view --
  // DEPLOY's is "activity". So the by-id fetch silently returned null for
  // Vercel forever (see the old `s ?? null` in main/ipc.ts), which is how
  // registering ext:vercel with a real section was blocked: there was no data
  // to show. steadyIntegrationFor must NOT apply pollSteady's filter -- it
  // computes DEPLOY's real value directly, same as it would for any manifest.
  it("computes a real value for an Activity-surfaced manifest, unlike pollSteady", async () => {
    expect(steadyView(DEPLOY)).toBeNull(); // confirms DEPLOY is NOT steady-view

    // pollSteady's own contract: excludes it entirely.
    expect(await pollSteady([DEPLOY], "/repo", 1000, {}, okRunner)).toEqual([]);

    // steadyIntegrationFor: computes it anyway.
    const value = await steadyIntegrationFor(
      DEPLOY,
      "/repo",
      1000,
      {},
      okRunner,
    );
    expect(value.status).toBe("ready");
    expect(value.view).toBe("activity"); // no steady view -> informational label
    expect(value.resources).toEqual([
      {
        id: "int:deploycli:dpl_1",
        title: "web",
        subtitle: "main",
        state: "running",
        href: "u1",
      },
    ]);
  });

  it("reports absent/unauthed for an Activity-surfaced manifest exactly like detectStatus would", async () => {
    const missing: CliRunner = async () => {
      throw Object.assign(new Error("nope"), { code: "ENOENT" });
    };
    expect(
      (await steadyIntegrationFor(DEPLOY, "/repo", 1000, {}, missing)).status,
    ).toBe("absent");

    const unauthed: CliRunner = async () => {
      throw Object.assign(new Error("not logged in"), { code: 1 });
    };
    expect(
      (await steadyIntegrationFor(DEPLOY, "/repo", 1000, {}, unauthed)).status,
    ).toBe("unauthed");
  });

  it("honors everyMs via the shared cache, same as pollSteady", async () => {
    let polls = 0;
    const run: CliRunner = async (_c, args) => {
      if (args[0] !== "whoami") polls++;
      return args[0] === "whoami" ? "" : LS_OUT;
    };
    const cache: SteadyCache = {};
    await steadyIntegrationFor(DEPLOY, "/repo", 1000, cache, run);
    await steadyIntegrationFor(DEPLOY, "/repo", 6000, cache, run); // within 20000
    expect(polls).toBe(1);
  });
});

describe("isRelevant", () => {
  const base: IntegrationManifest = {
    id: "az",
    name: "Azure",
    detect: { authCheck: { cmd: "az", args: ["account", "show"] } },
    poll: { everyMs: 1000, cli: { cmd: "az", args: ["webapp", "list"] } },
    map: { title: "$.name", state: { from: "$.state" } },
  };

  it("is always relevant when no relevance spec is declared", () => {
    expect(isRelevant(base, { secretNames: [], rootFiles: [] })).toBe(true);
  });

  it("is relevant when a vaulted secret name matches the env prefix", () => {
    const m = { ...base, relevance: { envPrefix: "AZURE_" } };
    expect(
      isRelevant(m, {
        secretNames: ["DATABASE_URL", "AZURE_STORAGE_KEY"],
        rootFiles: [],
      }),
    ).toBe(true);
  });

  it("is relevant when the project root contains a declared file", () => {
    const m = { ...base, relevance: { files: ["azure.yaml", ".azure"] } };
    expect(
      isRelevant(m, { secretNames: [], rootFiles: ["src", "azure.yaml"] }),
    ).toBe(true);
  });

  it("is NOT relevant when neither the env prefix nor any file matches", () => {
    const m = {
      ...base,
      relevance: { envPrefix: "AZURE_", files: ["azure.yaml"] },
    };
    expect(
      isRelevant(m, {
        secretNames: ["DATABASE_URL"],
        rootFiles: ["src", "package.json"],
      }),
    ).toBe(false);
  });
});

describe("detectWithOutput", () => {
  const m = DEPLOY; // any manifest; only its detect.authCheck is exercised
  it("returns ready + the auth check's stdout", async () => {
    const run: CliRunner = async () => '{"name":"My-Sub"}';
    expect(await detectWithOutput(m, undefined, 8000, run)).toEqual({
      status: "ready",
      stdout: '{"name":"My-Sub"}',
    });
  });
  it("returns absent + empty stdout when the binary is missing (ENOENT)", async () => {
    const run: CliRunner = async () => {
      throw Object.assign(new Error("nope"), { code: "ENOENT" });
    };
    expect(await detectWithOutput(m, undefined, 8000, run)).toEqual({
      status: "absent",
      stdout: "",
    });
  });
  it("returns unauthed + empty stdout on a non-ENOENT failure", async () => {
    const run: CliRunner = async () => {
      throw Object.assign(new Error("not logged in"), { code: 1 });
    };
    expect(await detectWithOutput(m, undefined, 8000, run)).toEqual({
      status: "unauthed",
      stdout: "",
    });
  });
});

// A project-scoped caller (a manifest's own rail section, and the Host/
// Databases provider rows) turns an account-wide list into "irrelevant" for a
// project that does not use the tool. The GATE itself lives in the IPC handler
// -- it needs the project's vaulted secret names and root listing, which the
// engine deliberately does not do I/O for. What the engine owes that caller is
// (a) a status field wide enough to carry the verdict and (b) the manifest's
// `relevance` spec, so the renderer can say WHAT would make the project
// relevant instead of a generic shrug.
describe("SteadyIntegration.status: irrelevant", () => {
  const azureish: IntegrationManifest = {
    id: "azureish",
    name: "Azureish",
    surface: { view: "host" },
    relevance: { envPrefix: "AZURE_", files: ["azure.yaml"] },
    detect: { authCheck: { cmd: "az", args: ["account", "show"] } },
    poll: { everyMs: 30000, cli: { cmd: "az", args: ["webapp", "list"] } },
    map: {
      items: "$",
      key: "$.name",
      title: "$.name",
      state: { from: "$.state", default: "idle" },
    },
  };

  it("is assignable as a status, with no resources", () => {
    const value: SteadyIntegration = {
      id: "azureish",
      name: "Azureish",
      view: "host",
      status: "irrelevant",
      resources: [],
    };
    expect(value.status).toBe("irrelevant");
    expect(value.resources).toEqual([]);
  });

  it("passes a manifest's relevance spec through, so the reason can name it", async () => {
    const run: CliRunner = async (_c, args) =>
      args[0] === "account" ? "" : JSON.stringify([]);
    const value = await steadyIntegrationFor(azureish, null, 1000, {}, run);
    expect(value.relevance).toEqual({
      envPrefix: "AZURE_",
      files: ["azure.yaml"],
    });
  });

  it("omits relevance for an account-global manifest, which has no spec", async () => {
    const value = await steadyIntegrationFor(
      DEPLOY,
      "/repo",
      1000,
      {},
      okRunner,
    );
    expect(value.relevance).toBeUndefined();
  });
});

describe("parseAccount", () => {
  it("extracts a string label at the JSONPath", () => {
    expect(
      parseAccount('{"name":"My-Sub","user":{"name":"me"}}', "$.name"),
    ).toBe("My-Sub");
    expect(parseAccount('{"user":{"name":"me@x"}}', "$.user.name")).toBe(
      "me@x",
    );
  });
  it("stringifies a numeric value", () => {
    expect(parseAccount('{"id":42}', "$.id")).toBe("42");
  });
  it("returns null on non-JSON, a missing path, or an empty string", () => {
    expect(parseAccount("not json", "$.name")).toBeNull();
    expect(parseAccount('{"other":1}', "$.name")).toBeNull();
    expect(parseAccount('{"name":""}', "$.name")).toBeNull();
  });
});
