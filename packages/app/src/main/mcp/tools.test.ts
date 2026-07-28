import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentCommandResult,
  CiRun,
  DevServerStartResult,
  EnvFileImport,
  JournalEntry,
  QuotaStatus,
  Section,
  SectionVisibility,
  SessionUsage,
  TerminalInputResult,
} from "../../shared/ipc";
import { BUILTIN_SECTIONS } from "../prefs";
import { registerTools, TOOL_NAMES } from "./tools";

// Mock agent-core's runCommand so the run_command handler tests can assert it is
// NOT invoked on the fail-closed (no-workspace) path. tools.ts imports runCommand
// directly (it does NOT inject it), so a module mock is the only seam. This also
// keeps the test from resolving/injecting real secrets or spawning a process.
// DEFAULT_AGENT_POLICY is included because prefs.ts (imported by tools.ts) reads
// it at module-init time to build DEFAULTS -- the mock must export it.
const runCommandMock = vi.fn();
vi.mock("@airlock/agent-core", () => ({
  DEFAULT_AGENT_POLICY: {
    network: "allow",
    outsideWorkspace: "ask",
    destructive: "ask",
    privilege: "block",
  },
  runCommand: (...args: unknown[]) => runCommandMock(...args),
  // ide-state's listSecretNames calls agent-core's listSecrets; the
  // list_secret_names handler test below needs it to resolve (empty vault).
  listSecrets: async () => [],
  // prefs.ts reads KNOWN_TERMINALS at module-init time to build TERMINAL_IDS;
  // the mock must export it or any test that imports prefs (directly or
  // transitively through tools.ts) will throw at import time.
  KNOWN_TERMINALS: [],
}));

// A minimal McpServer stand-in that records every registerTool call. registerTools
// only ever calls .registerTool, so this captures the full registered surface
// (names, configs, handlers) without standing up the real SDK server or Electron.
type Recorded = {
  name: string;
  config: { inputSchema?: Record<string, unknown> };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

function fakeServer(): { mcp: McpServer; tools: Recorded[] } {
  const tools: Recorded[] = [];
  const mcp = {
    registerTool: (
      name: string,
      config: Recorded["config"],
      handler: Recorded["handler"],
    ) => {
      tools.push({ name, config, handler });
    },
  } as unknown as McpServer;
  return { mcp, tools };
}

const baseDeps = {
  prefsFile: "/tmp/airlock-test-prefs.json",
  getWorkspaceRoot: () => null as string | null,
  listExtensions: vi.fn(
    async () => [] as import("@airlock/agent-core").ExtensionSummary[],
  ),
  selfVerifyEnabled: vi.fn(async () => false),
  captureScreenshot: vi.fn(async () => null as string | null),
  setPref: vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string }),
  getBaseEnv: () => ({}) as Record<string, string>,
  requestSecretFromUser: vi.fn(async () => ({ vaulted: true })),
  // Terminal deps now take root as the third/first param (scoped to calling
  // session's project, not GUI focus). Test doubles accept and ignore it;
  // per-test overrides can assert it when the call path matters.
  getTerminalTail: vi.fn(
    async (
      _termId: string,
      _lines: number,
      _root: string | null,
    ): Promise<{ tail: string } | { error: string }> => ({ tail: "" }),
  ),
  listTerminals: vi.fn(
    async (
      _root: string | null,
    ): Promise<{ id: string; preview: string }[]> => [],
  ),
  getCiRun: vi.fn(
    async (): Promise<{ branch: string; run: CiRun } | null> => null,
  ),
  // The injected batch env importer for import_env (the real one is agent-core's
  // importAllDotEnv, wired in server.ts) + the secrets:changed broadcast. Both
  // injected so these tests never touch the keychain/fs or Electron windows.
  importEnvFiles: vi.fn(async () => [] as EnvFileImport[]),
  notifySecretsChanged: vi.fn((_root: string) => {}),
  // The quota/usage reads for plan_usage: main's cached account status and the
  // per-session ledger. Metadata only -- usage numbers, never a secret value.
  getQuota: vi.fn(() => null as QuotaStatus | null),
  getUsageLedger: vi.fn(() => [] as SessionUsage[]),
  // The IDE-control round-trip stub: resolves an ok result with an empty layout
  // by default. Tests that assert the forwarded AgentCommand or the !ok mapping
  // override this with their own spy.
  runAgentCommand: vi.fn(
    async () =>
      ({
        ok: true,
        data: { tabs: [], split: null, appPages: { open: [], shown: null } },
      }) as AgentCommandResult,
  ),
  // The project profile + overview.md for the focused project; value-free metadata.
  getProjectInfo: vi.fn(async () => ({
    profile: {},
    summary: null,
    summaryMtimeMs: 0,
  })),
  // Gated terminal input for send_terminal_input: resolves a value-free outcome
  // (sent/denied/timedOut/busy/error), never terminal output or a secret. The
  // grant + write are stubbed so these tests never open a modal or touch a pty.
  // The return is annotated as the full TerminalInputResult so per-test overrides
  // returning a non-sent outcome (e.g. {error}) still spread cleanly over baseDeps.
  sendTerminalInput: vi.fn(
    async (): Promise<TerminalInputResult> => ({ sent: true }),
  ),
  // Dev server deps for start_dev_server/stop_dev_server: metadata only (status/
  // url/port/terminalId/command/startedBy/exitCode), never a secret value.
  getDevServerState: vi.fn((_root: string) => ({
    status: "idle" as const,
    port: null,
    url: null,
    terminalId: null,
    command: null,
    startedBy: null,
    exitCode: null,
  })),
  startDevServer: vi.fn(
    async (
      _root: string,
      _startedBy: "user" | "agent",
    ): Promise<DevServerStartResult> => ({
      ok: true,
      state: {
        status: "idle" as const,
        port: null,
        url: null,
        terminalId: null,
        command: null,
        startedBy: null,
        exitCode: null,
      },
    }),
  ),
  stopDevServer: vi.fn((_root: string) => ({
    status: "idle" as const,
    port: null,
    url: null,
    terminalId: null,
    command: null,
    startedBy: null,
    exitCode: null,
  })),
  slackListAllowedChannels: vi.fn(async () => ({ channels: [] })),
  slackReadChannel: vi.fn(async () => ({ error: "not connected" })),
  githubReadIssue: vi.fn(async () => ({ error: "not connected" })),
  addChangelogEntries: vi.fn(
    async (): Promise<
      | { ok: true; added: number; skipped: number; entries: JournalEntry[] }
      | { ok: false; error: string }
    > => ({
      ok: true,
      added: 1,
      skipped: 0,
      entries: [{ ts: 1, tag: "note", text: "x" }],
    }),
  ),
  updateChangelogNotes: vi.fn(
    async (): Promise<
      | { ok: true; updated: number; skipped: number }
      | { ok: false; error: string }
    > => ({ ok: true, updated: 1, skipped: 0 }),
  ),
};

describe("registerTools allowlist guard", () => {
  // The core security gate: the registered tool set is LOCKED to exactly the
  // TOOL_NAMES allowlist (read/curate/run/commit + the IDE-control tools). An
  // extra tool (e.g. a future secret-value drill-down) or a removed one fails
  // this immediately. The numeric assertion below pins the size so a drift in
  // TOOL_NAMES itself is loud rather than silently accepted.
  it("registers exactly the allowlisted tools and nothing else", () => {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, baseDeps);

    const registered = tools.map((t) => t.name).sort();
    expect(registered).toEqual([...TOOL_NAMES].sort());
    expect(registered).toHaveLength(36);
    expect(registered).toContain("start_dev_server");
    expect(registered).toContain("stop_dev_server");
    expect(registered).toContain("project_info");
    expect(registered).toContain("git_commit");
    expect(registered).toContain("run_command");
    expect(registered).toContain("request_secret");
    expect(registered).toContain("import_env");
    expect(registered).toContain("ci_status");
    expect(registered).toContain("plan_usage");
    // The nine IDE-control tools (tabs / split / terminals / page-tabs).
    expect(registered).toContain("list_tabs");
    expect(registered).toContain("open_tab");
    expect(registered).toContain("close_tab");
    expect(registered).toContain("switch_tab");
    expect(registered).toContain("split_view");
    expect(registered).toContain("open_terminal");
    expect(registered).toContain("close_terminal");
    expect(registered).toContain("open_app_page");
    expect(registered).toContain("close_app_page");
  });

  it("registers no duplicate tool names", () => {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, baseDeps);
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("mcp-docs / allowlist parity", () => {
  // The docs are MCP resources the agent reads to learn its capabilities; a
  // tool missing from the manual (or a stale count) is an agent-facing contract
  // drift. Locks tools.md to the allowlist the same way the guard above locks
  // the registration.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const toolsDoc = readFileSync(
    path.join(here, "../../../resources/mcp-docs/tools.md"),
    "utf8",
  );

  it("mentions every allowlisted tool in tools.md", () => {
    for (const name of TOOL_NAMES) {
      expect(toolsDoc).toContain(`\`${name}\``);
    }
  });

  it("states the exact allowlist size as its tool count", () => {
    expect(toolsDoc).toContain(`${TOOL_NAMES.length} tools`);
  });
});

describe("tools.ts secret-value source guard", () => {
  // Source-level invariant: tools.ts must never reference a value-returning
  // function. This catches a future edit that imports/calls one even before it
  // would show up as a behavior change.
  const FORBIDDEN = [
    "getSecretValue",
    "getGlobalSecret",
    "neonConnectionUri",
    "dbConnString",
    "injectInto",
    "vaultedSecrets",
  ];

  it("contains none of the forbidden value-returning identifiers", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "tools.ts"), "utf8");
    for (const id of FORBIDDEN) {
      expect(source).not.toContain(id);
    }
  });
});

describe("set_sidebar_section_visibility validation", () => {
  function getVisibilityTool(
    changeVisibility: (
      prefsFile: string,
      id: Section,
      visible: boolean,
    ) => Promise<SectionVisibility>,
  ) {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, { ...baseDeps, changeVisibility });
    const tool = tools.find((t) => t.name === "set_sidebar_section_visibility");
    if (!tool) throw new Error("visibility tool not registered");
    return tool;
  }

  it("rejects an unknown section without calling changeVisibility", async () => {
    const spy = vi.fn(async () => ({}) as SectionVisibility);
    const tool = getVisibilityTool(spy);
    const res = (await tool.handler({
      section: "not-a-real-section",
      visible: true,
    })) as { isError?: boolean };
    expect(res.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("calls changeVisibility with the prefsFile, section, and visible for a valid section", async () => {
    const nextMap = { docker: false } as unknown as SectionVisibility;
    const spy = vi.fn(async () => nextMap);
    const tool = getVisibilityTool(spy);
    const section = BUILTIN_SECTIONS[0];
    const res = (await tool.handler({ section, visible: false })) as {
      content: [{ text: string }];
      isError?: boolean;
    };
    expect(spy).toHaveBeenCalledWith(baseDeps.prefsFile, section, false);
    expect(res.isError).toBeUndefined();
    // The handler forwards the new map verbatim as JSON text.
    expect(JSON.parse(res.content[0].text)).toEqual(nextMap);
  });

  it("accepts an ext:* section id (extension sections are runtime-discovered)", async () => {
    const nextMap = { "ext:slack": false } as unknown as SectionVisibility;
    const spy = vi.fn(async () => nextMap);
    const tool = getVisibilityTool(spy);
    const res = (await tool.handler({
      section: "ext:slack",
      visible: false,
    })) as { isError?: boolean };
    expect(res.isError).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(baseDeps.prefsFile, "ext:slack", false);
  });

  it("rejects a malformed ext id without calling changeVisibility", async () => {
    const spy = vi.fn(async () => ({}) as SectionVisibility);
    const tool = getVisibilityTool(spy);
    const res = (await tool.handler({ section: "ext:", visible: true })) as {
      isError?: boolean;
    };
    expect(res.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("declares the section input schema", () => {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, baseDeps);
    const tool = tools.find((t) => t.name === "set_sidebar_section_visibility");
    expect(tool?.config.inputSchema).toBeDefined();
    expect(tool?.config.inputSchema?.section).toBeDefined();
    expect(tool?.config.inputSchema?.visible).toBeDefined();
  });
});

describe("app-page tools cover every AppPage", () => {
  // The zod enum cannot be derived from the AppPage type, so it silently fell
  // behind when "extensions" was added and the agent could not open that page.
  const PAGES = ["settings", "usage", "extensions"];
  it.each([
    "open_app_page",
    "close_app_page",
  ])("%s accepts every page name", (toolName) => {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, baseDeps);
    const tool = tools.find((t) => t.name === toolName);
    const schema = tool?.config.inputSchema?.page as
      | { options?: unknown[] }
      | undefined;
    expect(schema).toBeDefined();
    // zod enums expose their members as `options`.
    expect([...((schema?.options as string[]) ?? [])].sort()).toEqual(
      [...PAGES].sort(),
    );
  });
});

describe("run_command tool", () => {
  function getRunCommandTool() {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, baseDeps);
    const tool = tools.find((t) => t.name === "run_command");
    if (!tool) throw new Error("run_command tool not registered");
    return tool;
  }

  it("declares the command/injectSecrets/cwd input schema", () => {
    const tool = getRunCommandTool();
    expect(tool.config.inputSchema).toBeDefined();
    expect(tool.config.inputSchema?.command).toBeDefined();
    expect(tool.config.inputSchema?.injectSecrets).toBeDefined();
    expect(tool.config.inputSchema?.cwd).toBeDefined();
  });

  it("returns NO_WORKSPACE and does NOT call runCommand with no workspace open", async () => {
    runCommandMock.mockClear();
    // baseDeps.getWorkspaceRoot() is null, so the handler must short-circuit
    // before reaching agent-core's runCommand (which resolves/injects secrets).
    const tool = getRunCommandTool();
    const res = (await tool.handler({ command: "echo hi" })) as {
      content: [{ text: string }];
      isError?: boolean;
    };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("No workspace open");
    expect(runCommandMock).not.toHaveBeenCalled();
  });
});

describe("request_secret tool", () => {
  function getRequestSecretTool(deps = baseDeps) {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, deps);
    const tool = tools.find((t) => t.name === "request_secret");
    if (!tool) throw new Error("request_secret tool not registered");
    return tool;
  }

  it("declares the name/providerHint input schema", () => {
    const tool = getRequestSecretTool();
    expect(tool.config.inputSchema).toBeDefined();
    expect(tool.config.inputSchema?.name).toBeDefined();
    expect(tool.config.inputSchema?.providerHint).toBeDefined();
  });

  it("returns NO_WORKSPACE and does NOT call requestSecretFromUser with no workspace open", async () => {
    // baseDeps.getWorkspaceRoot() is null, so the handler must short-circuit
    // before reaching the resolver (which would open the secure prompt).
    const requestSecretFromUser = vi.fn(async () => ({ vaulted: true }));
    const tool = getRequestSecretTool({ ...baseDeps, requestSecretFromUser });
    const res = (await tool.handler({ name: "DATABASE_URL" })) as {
      content: [{ text: string }];
      isError?: boolean;
    };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("No workspace open");
    expect(requestSecretFromUser).not.toHaveBeenCalled();
  });
});

describe("get_terminal_tail tool", () => {
  // Build the tool against a deps object whose getWorkspaceRoot/getTerminalTail/
  // listTerminals are spies, so each test can assert which dep the handler
  // reached (and which it did NOT) on a given branch.
  function getTerminalTailTool(deps: typeof baseDeps) {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, deps);
    const tool = tools.find((t) => t.name === "get_terminal_tail");
    if (!tool) throw new Error("get_terminal_tail tool not registered");
    return tool;
  }

  it("declares the terminalId/lines input schema", () => {
    const tool = getTerminalTailTool(baseDeps);
    expect(tool.config.inputSchema).toBeDefined();
    expect(tool.config.inputSchema?.terminalId).toBeDefined();
    expect(tool.config.inputSchema?.lines).toBeDefined();
  });

  it("returns NO_WORKSPACE and calls NEITHER dep with no workspace open", async () => {
    // baseDeps.getWorkspaceRoot() is null, so the handler must short-circuit
    // before reaching listTerminals/getTerminalTail (which read PTY buffers).
    const getTerminalTail = vi.fn(
      async () => ({ tail: "x" }) as { tail: string } | { error: string },
    );
    const listTerminals = vi.fn(
      async (_root: string | null) => [] as { id: string; preview: string }[],
    );
    const tool = getTerminalTailTool({
      ...baseDeps,
      getTerminalTail,
      listTerminals,
    });
    const res = (await tool.handler({})) as {
      content: [{ text: string }];
      isError?: boolean;
    };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("No workspace open");
    expect(getTerminalTail).not.toHaveBeenCalled();
    expect(listTerminals).not.toHaveBeenCalled();
  });

  it("with a root and NO terminalId, calls listTerminals(root) and returns the list", async () => {
    const list = [{ id: "t1", preview: "npm run dev" }];
    const getTerminalTail = vi.fn(
      async () => ({ tail: "x" }) as { tail: string } | { error: string },
    );
    const listTerminals = vi.fn(async (_root: string | null) => list);
    const tool = getTerminalTailTool({
      ...baseDeps,
      getWorkspaceRoot: () => "/repo",
      getTerminalTail,
      listTerminals,
    });
    const res = (await tool.handler({})) as {
      content: [{ text: string }];
      isError?: boolean;
    };
    // root is threaded so listTerminals can scope to the calling session's project.
    expect(listTerminals).toHaveBeenCalledWith("/repo");
    expect(getTerminalTail).not.toHaveBeenCalled();
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toEqual(list);
  });

  it("with a root and a terminalId, calls getTerminalTail(id, lines, root) and returns the tail", async () => {
    const getTerminalTail = vi.fn(
      async () =>
        ({ tail: "build ok" }) as { tail: string } | { error: string },
    );
    const listTerminals = vi.fn(
      async (_root: string | null) => [] as { id: string; preview: string }[],
    );
    const tool = getTerminalTailTool({
      ...baseDeps,
      getWorkspaceRoot: () => "/repo",
      getTerminalTail,
      listTerminals,
    });
    const res = (await tool.handler({ terminalId: "t1", lines: 10 })) as {
      content: [{ text: string }];
      isError?: boolean;
    };
    // root is threaded through so the dep can scope to the calling session's project.
    expect(getTerminalTail).toHaveBeenCalledWith("t1", 10, "/repo");
    expect(listTerminals).not.toHaveBeenCalled();
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toEqual({ tail: "build ok" });
  });

  it("defaults lines to 40 when only a terminalId is given", async () => {
    const getTerminalTail = vi.fn(
      async () => ({ tail: "" }) as { tail: string } | { error: string },
    );
    const listTerminals = vi.fn(
      async (_root: string | null) => [] as { id: string; preview: string }[],
    );
    const tool = getTerminalTailTool({
      ...baseDeps,
      getWorkspaceRoot: () => "/repo",
      getTerminalTail,
      listTerminals,
    });
    await tool.handler({ terminalId: "t1" });
    // root is threaded through; default lines is 40.
    expect(getTerminalTail).toHaveBeenCalledWith("t1", 40, "/repo");
  });

  it("surfaces a getTerminalTail {error} result as isError", async () => {
    const getTerminalTail = vi.fn(
      async () => ({ error: "No such terminal" }) as { error: string },
    );
    const listTerminals = vi.fn(
      async (_root: string | null) => [] as { id: string; preview: string }[],
    );
    const tool = getTerminalTailTool({
      ...baseDeps,
      getWorkspaceRoot: () => "/repo",
      getTerminalTail,
      listTerminals,
    });
    const res = (await tool.handler({ terminalId: "nope" })) as {
      content: [{ text: string }];
      isError?: boolean;
    };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("No such terminal");
  });
});

describe("send_terminal_input tool", () => {
  // Build the tool against a deps object whose sendTerminalInput is a spy, so
  // each test can assert the forwarded (terminalId, data) and the outcome
  // mapping. The dep resolves a value-free outcome -- never terminal output.
  function getSendTerminalInputTool(deps: typeof baseDeps) {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, deps);
    const tool = tools.find((t) => t.name === "send_terminal_input");
    if (!tool) throw new Error("send_terminal_input tool not registered");
    return tool;
  }

  it("forwards (terminalId, data) to the dep and wraps the outcome", async () => {
    const sendTerminalInput = vi.fn(
      async (): Promise<TerminalInputResult> => ({ sent: true }),
    );
    const tool = getSendTerminalInputTool({ ...baseDeps, sendTerminalInput });
    const res = (await tool.handler({ terminalId: "p1", data: "hi\n" })) as {
      content: [{ text: string }];
      isError?: boolean;
    };
    expect(sendTerminalInput).toHaveBeenCalledWith("p1", "hi\n");
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toEqual({ sent: true });
  });

  it("surfaces an error outcome as isError", async () => {
    const sendTerminalInput = vi.fn(
      async (): Promise<TerminalInputResult> => ({ error: "No such terminal" }),
    );
    const tool = getSendTerminalInputTool({ ...baseDeps, sendTerminalInput });
    const res = (await tool.handler({ terminalId: "dead", data: "x" })) as {
      content: [{ text: string }];
      isError?: boolean;
    };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("No such terminal");
  });
});

describe("ci_status tool", () => {
  // Replaced activity_status when the Activity panel was deleted. Its other two
  // sources (Render deploys, Docker containers) are already covered by
  // render_services and the docker/database tools; CI was the only thing the
  // feed uniquely knew, so the tool narrowed with the panel.
  function ciTool(deps: typeof baseDeps) {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, deps);
    const tool = tools.find((t) => t.name === "ci_status");
    if (!tool) throw new Error("ci_status tool not registered");
    return tool;
  }

  const RUN: CiRun = {
    workflowName: "CI",
    status: "in_progress",
    conclusion: null,
    headSha: "abc123",
    url: "https://github.com/o/r/actions/runs/1",
    steps: [],
    stepsDone: 1,
    stepsTotal: 3,
  };

  it("declares an empty input schema (no args)", () => {
    expect(ciTool(baseDeps).config.inputSchema).toEqual({});
  });

  it("returns the run from deps.getCiRun, passing the workspace root", async () => {
    const getCiRun = vi.fn(async () => ({ branch: "main", run: RUN }));
    const tool = ciTool({
      ...baseDeps,
      getWorkspaceRoot: () => "/repo",
      getCiRun,
    });
    const res = (await tool.handler({})) as {
      content: [{ text: string }];
      isError?: boolean;
    };
    expect(getCiRun).toHaveBeenCalledWith("/repo");
    expect(res.isError).toBeUndefined();
    // The result echoes WHICH root it answered for (QA 2026-06-11: the tools
    // follow GUI focus, so the agent must be able to detect a focus change).
    expect(JSON.parse(res.content[0].text)).toEqual({
      root: "/repo",
      ci: { branch: "main", run: RUN },
    });
  });

  // No repo / no gh / no workflow / detached HEAD all arrive here as null. That
  // is a normal answer, not an error -- the agent should report "no CI", not
  // "the tool failed".
  it("reports null without erroring when there is no run", async () => {
    const getCiRun = vi.fn(async () => null);
    const tool = ciTool({
      ...baseDeps,
      getWorkspaceRoot: () => null,
      getCiRun,
    });
    const res = (await tool.handler({})) as {
      content: [{ text: string }];
      isError?: boolean;
    };
    expect(getCiRun).toHaveBeenCalledWith(null);
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text).ci).toBeNull();
  });
});
