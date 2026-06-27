import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type {
  ActivityItem,
  AgentCommand,
  AgentCommandResult,
  EnvFileImport,
  QuotaStatus,
  SecretMeta,
  Section,
  SectionVisibility,
  SessionUsage,
  TabsSnapshot,
  TerminalInputResult,
} from "../../shared/ipc";
import { SECTIONS } from "../prefs";
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
  getBaseEnv: () => ({}) as Record<string, string>,
  requestSecretFromUser: vi.fn(async () => ({ vaulted: true })),
  getTerminalTail: vi.fn(
    async () => ({ tail: "" }) as { tail: string } | { error: string },
  ),
  listTerminals: vi.fn(async () => [] as { id: string; preview: string }[]),
  getActivity: vi.fn(async () => [] as ActivityItem[]),
  dismissActivity: vi.fn((_entryId: string) => {}),
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
};

describe("registerTools allowlist guard", () => {
  // The core security gate: the registered tool set is LOCKED to exactly the
  // twenty-nine allowlisted tools (twenty read/curate/run/commit + the nine
  // IDE-control tools). An extra tool (e.g. a future secret-value drill-down) or a
  // removed one fails this immediately.
  it("registers exactly the twenty-nine allowlisted tools and nothing else", () => {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, baseDeps);

    const registered = tools.map((t) => t.name).sort();
    expect(registered).toEqual([...TOOL_NAMES].sort());
    expect(registered).toHaveLength(29);
    expect(registered).toContain("project_info");
    expect(registered).toContain("git_commit");
    expect(registered).toContain("run_command");
    expect(registered).toContain("request_secret");
    expect(registered).toContain("import_env");
    expect(registered).toContain("activity_status");
    expect(registered).toContain("dismiss_activity");
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

  it("rejects a section not in SECTIONS without calling changeVisibility", async () => {
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
    const section = SECTIONS[0];
    const res = (await tool.handler({ section, visible: false })) as {
      content: [{ text: string }];
      isError?: boolean;
    };
    expect(spy).toHaveBeenCalledWith(baseDeps.prefsFile, section, false);
    expect(res.isError).toBeUndefined();
    // The handler forwards the new map verbatim as JSON text.
    expect(JSON.parse(res.content[0].text)).toEqual(nextMap);
  });

  it("declares the section input schema as the SECTIONS enum", () => {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, baseDeps);
    const tool = tools.find((t) => t.name === "set_sidebar_section_visibility");
    expect(tool?.config.inputSchema).toBeDefined();
    expect(tool?.config.inputSchema?.section).toBeDefined();
    expect(tool?.config.inputSchema?.visible).toBeDefined();
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
    const getTerminalTail = vi.fn(async () => ({ tail: "x" }));
    const listTerminals = vi.fn(async () => []);
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

  it("with a root and NO terminalId, calls listTerminals and returns the list", async () => {
    const list = [{ id: "t1", preview: "npm run dev" }];
    const getTerminalTail = vi.fn(async () => ({ tail: "x" }));
    const listTerminals = vi.fn(async () => list);
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
    expect(listTerminals).toHaveBeenCalledTimes(1);
    expect(getTerminalTail).not.toHaveBeenCalled();
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toEqual(list);
  });

  it("with a root and a terminalId, calls getTerminalTail(id, lines) and returns the tail", async () => {
    const getTerminalTail = vi.fn(async () => ({ tail: "build ok" }));
    const listTerminals = vi.fn(async () => []);
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
    expect(getTerminalTail).toHaveBeenCalledWith("t1", 10);
    expect(listTerminals).not.toHaveBeenCalled();
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toEqual({ tail: "build ok" });
  });

  it("defaults lines to 40 when only a terminalId is given", async () => {
    const getTerminalTail = vi.fn(async () => ({ tail: "" }));
    const listTerminals = vi.fn(async () => []);
    const tool = getTerminalTailTool({
      ...baseDeps,
      getWorkspaceRoot: () => "/repo",
      getTerminalTail,
      listTerminals,
    });
    await tool.handler({ terminalId: "t1" });
    expect(getTerminalTail).toHaveBeenCalledWith("t1", 40);
  });

  it("surfaces a getTerminalTail {error} result as isError", async () => {
    const getTerminalTail = vi.fn(async () => ({ error: "No such terminal" }));
    const listTerminals = vi.fn(async () => []);
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

describe("activity_status tool", () => {
  // Build the tool against a deps object whose getWorkspaceRoot/getActivity are
  // spies, so each test can assert what the read forwarded and returned.
  function getActivityTool(deps: typeof baseDeps) {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, deps);
    const tool = tools.find((t) => t.name === "activity_status");
    if (!tool) throw new Error("activity_status tool not registered");
    return tool;
  }

  it("declares an empty input schema (no args)", () => {
    const tool = getActivityTool(baseDeps);
    expect(tool.config.inputSchema).toEqual({});
  });

  it("returns the items from deps.getActivity, passing the workspace root", async () => {
    const items: ActivityItem[] = [
      {
        id: "ci:abc123",
        kind: "ci",
        title: "CI",
        subtitle: "main",
        state: "running",
        progress: { kind: "indeterminate" },
      },
    ];
    const getActivity = vi.fn(async () => items);
    const tool = getActivityTool({
      ...baseDeps,
      getWorkspaceRoot: () => "/repo",
      getActivity,
    });
    const res = (await tool.handler({})) as {
      content: [{ text: string }];
      isError?: boolean;
    };
    // activity_status handles a null root itself (like render_services), so it
    // forwards the root verbatim rather than short-circuiting on no workspace.
    expect(getActivity).toHaveBeenCalledWith("/repo");
    expect(res.isError).toBeUndefined();
    // The result echoes WHICH root it answered for (QA 2026-06-11: the tools
    // follow GUI focus, so the agent must be able to detect a focus change).
    expect(JSON.parse(res.content[0].text)).toEqual({
      root: "/repo",
      activity: items,
    });
  });

  it("forwards a null root (no folder open) without erroring", async () => {
    const getActivity = vi.fn(async () => [] as ActivityItem[]);
    const tool = getActivityTool({
      ...baseDeps,
      getWorkspaceRoot: () => null,
      getActivity,
    });
    const res = (await tool.handler({})) as { isError?: boolean };
    expect(getActivity).toHaveBeenCalledWith(null);
    expect(res.isError).toBeUndefined();
  });
});

describe("dismiss_activity tool", () => {
  function getDismissTool(deps: typeof baseDeps) {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, deps);
    const tool = tools.find((t) => t.name === "dismiss_activity");
    if (!tool) throw new Error("dismiss_activity tool not registered");
    return tool;
  }

  it("declares the entryId input schema", () => {
    const tool = getDismissTool(baseDeps);
    expect(tool.config.inputSchema).toBeDefined();
    expect(tool.config.inputSchema?.entryId).toBeDefined();
  });

  it("calls deps.dismissActivity with the entryId and echoes it back", async () => {
    const dismissActivity = vi.fn((_entryId: string) => {});
    const tool = getDismissTool({ ...baseDeps, dismissActivity });
    const res = (await tool.handler({ entryId: "ci:abc123" })) as {
      content: [{ text: string }];
      isError?: boolean;
    };
    expect(dismissActivity).toHaveBeenCalledWith("ci:abc123");
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toEqual({ dismissed: "ci:abc123" });
  });
});

describe("IDE-control tools (tabs / split / terminals / page-tabs)", () => {
  // A sample layout the round-trip resolves on the ok path; the handler must
  // forward it verbatim as JSON (it is layout metadata -- names/titles only).
  const SNAPSHOT: TabsSnapshot = {
    tabs: [
      {
        id: "proj-1",
        name: "repo",
        root: "/repo",
        focused: true,
        inSplit: false,
        terminals: [{ id: "term-1", ptyId: "pty-uuid-1", title: "zsh" }],
      },
    ],
    split: null,
    appPages: { open: ["usage"], shown: null },
  };

  // Build one IDE-control tool against a runAgentCommand spy so each test can
  // assert the exact AgentCommand the handler forwarded and the result mapping.
  function getTool(
    name: string,
    runAgentCommand: (cmd: AgentCommand) => Promise<AgentCommandResult>,
  ) {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, { ...baseDeps, runAgentCommand });
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`${name} tool not registered`);
    return tool;
  }

  // (toolName, handler args, expected AgentCommand) for the happy path: each tool
  // builds the right command and returns r.data on ok.
  const cases: Array<{
    name: string;
    args: Record<string, unknown>;
    cmd: AgentCommand;
  }> = [
    { name: "list_tabs", args: {}, cmd: { type: "list_tabs" } },
    // open_tab WITH a path is confined (PB-C1) and covered by its own tests below;
    // the no-path (blank tab) case forwards unconditionally.
    {
      name: "open_tab",
      args: {},
      cmd: { type: "open_tab", path: undefined },
    },
    {
      name: "close_tab",
      args: { tabId: "proj-2" },
      cmd: { type: "close_tab", tabId: "proj-2" },
    },
    {
      name: "switch_tab",
      args: { tabId: "proj-3" },
      cmd: { type: "switch_tab", tabId: "proj-3" },
    },
    {
      name: "split_view",
      args: {},
      cmd: { type: "split_view", tabId: undefined },
    },
    {
      name: "split_view",
      args: { tabId: "proj-4" },
      cmd: { type: "split_view", tabId: "proj-4" },
    },
    {
      name: "open_terminal",
      args: {},
      cmd: { type: "open_terminal", tabId: undefined },
    },
    {
      name: "open_terminal",
      args: { tabId: "proj-5" },
      cmd: { type: "open_terminal", tabId: "proj-5" },
    },
    {
      name: "close_terminal",
      args: { terminalId: "term-9" },
      cmd: { type: "close_terminal", terminalId: "term-9" },
    },
    {
      name: "open_app_page",
      args: { page: "usage" },
      cmd: { type: "open_app_page", page: "usage" },
    },
    {
      name: "open_app_page",
      args: { page: "settings" },
      cmd: { type: "open_app_page", page: "settings" },
    },
    {
      name: "close_app_page",
      args: { page: "settings" },
      cmd: { type: "close_app_page", page: "settings" },
    },
  ];

  for (const { name, args, cmd } of cases) {
    it(`${name}(${JSON.stringify(args)}) forwards ${JSON.stringify(
      cmd,
    )} and returns the snapshot on ok`, async () => {
      const runAgentCommand = vi.fn(
        async () => ({ ok: true, data: SNAPSHOT }) as AgentCommandResult,
      );
      const tool = getTool(name, runAgentCommand);
      const res = (await tool.handler(args)) as {
        content: [{ text: string }];
        isError?: boolean;
      };
      expect(runAgentCommand).toHaveBeenCalledTimes(1);
      expect(runAgentCommand).toHaveBeenCalledWith(cmd);
      expect(res.isError).toBeUndefined();
      expect(JSON.parse(res.content[0].text)).toEqual(SNAPSHOT);
    });
  }

  it("returns isError with the error message when the command result is !ok", async () => {
    const runAgentCommand = vi.fn(
      async () =>
        ({ ok: false, error: "No airlock window" }) as AgentCommandResult,
    );
    const tool = getTool("list_tabs", runAgentCommand);
    const res = (await tool.handler({})) as {
      content: [{ text: string }];
      isError?: boolean;
    };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("No airlock window");
  });

  it("does NOT gate the IDE-control tools on an open workspace (acts on the focused window)", async () => {
    // baseDeps.getWorkspaceRoot() is null. Unlike the workspace-rooted reads the
    // IDE-control tools must still reach runAgentCommand (layout control applies to
    // any window, including a blank-tab one), so the call goes through.
    const runAgentCommand = vi.fn(
      async () => ({ ok: true, data: SNAPSHOT }) as AgentCommandResult,
    );
    // A blank tab (no path) needs no workspace and no path-sanctioning, so it
    // still reaches runAgentCommand even with getWorkspaceRoot() null.
    const tool = getTool("open_tab", runAgentCommand);
    const res = (await tool.handler({})) as { isError?: boolean };
    expect(runAgentCommand).toHaveBeenCalledWith({
      type: "open_tab",
      path: undefined,
    });
    expect(res.isError).toBeUndefined();
  });

  // PB-C1: open_tab confines the agent's path to a folder the user already
  // opened (a current/recent root or a subfolder), so the agent cannot point its
  // own workspace root at an arbitrary directory and self-poison resolveRoot.
  it("open_tab forwards a path inside an open root (PB-C1)", async () => {
    const runAgentCommand = vi.fn(
      async () => ({ ok: true, data: SNAPSHOT }) as AgentCommandResult,
    );
    const { mcp, tools } = fakeServer();
    registerTools(mcp, {
      ...baseDeps,
      getWorkspaceRoot: () => "/repo",
      runAgentCommand,
    });
    const tool = tools.find((t) => t.name === "open_tab");
    if (!tool) throw new Error("open_tab not registered");
    await tool.handler({ path: "/repo/packages/app" });
    expect(runAgentCommand).toHaveBeenCalledWith({
      type: "open_tab",
      path: "/repo/packages/app",
    });
  });

  it("open_tab REJECTS a path outside any open/recent root (PB-C1)", async () => {
    const runAgentCommand = vi.fn(
      async () => ({ ok: true, data: SNAPSHOT }) as AgentCommandResult,
    );
    const { mcp, tools } = fakeServer();
    registerTools(mcp, {
      ...baseDeps,
      getWorkspaceRoot: () => "/repo",
      runAgentCommand,
    });
    const tool = tools.find((t) => t.name === "open_tab");
    if (!tool) throw new Error("open_tab not registered");
    const res = (await tool.handler({ path: "/Users/victim/.ssh" })) as {
      isError?: boolean;
      content: [{ text: string }];
    };
    expect(runAgentCommand).not.toHaveBeenCalled();
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/already opened/i);
  });

  it("declares the expected input schemas (optional path/tabId, required tabId/terminalId)", () => {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, baseDeps);
    const byName = (n: string) => tools.find((t) => t.name === n);
    // list_tabs: empty schema (no args).
    expect(byName("list_tabs")?.config.inputSchema).toEqual({});
    expect(byName("open_tab")?.config.inputSchema?.path).toBeDefined();
    expect(byName("close_tab")?.config.inputSchema?.tabId).toBeDefined();
    expect(byName("switch_tab")?.config.inputSchema?.tabId).toBeDefined();
    expect(byName("split_view")?.config.inputSchema?.tabId).toBeDefined();
    expect(byName("open_terminal")?.config.inputSchema?.tabId).toBeDefined();
    expect(
      byName("close_terminal")?.config.inputSchema?.terminalId,
    ).toBeDefined();
    // The page-tab tools take the page enum ("settings" | "usage").
    expect(byName("open_app_page")?.config.inputSchema?.page).toBeDefined();
    expect(byName("close_app_page")?.config.inputSchema?.page).toBeDefined();
  });
});

describe("import_env tool", () => {
  function getTool(overrides: Partial<typeof baseDeps> = {}) {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, { ...baseDeps, ...overrides });
    const tool = tools.find((t) => t.name === "import_env");
    if (!tool) throw new Error("import_env tool not registered");
    return tool;
  }

  const importedResult = (file: string, names: string[]): EnvFileImport => ({
    file,
    result: {
      imported: names.map((name) => ({ name }) as SecretMeta),
      skipped: [],
      failed: [],
      deleted: false,
    },
  });

  it("errors cleanly with no workspace and never calls the importer", async () => {
    const importEnvFiles = vi.fn(async () => [] as EnvFileImport[]);
    const tool = getTool({ importEnvFiles });
    const res = (await tool.handler({})) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toBe("No workspace open");
    expect(importEnvFiles).not.toHaveBeenCalled();
  });

  it("forwards files + deleteAfter and stamps the agent actor", async () => {
    const importEnvFiles = vi.fn(async () => [] as EnvFileImport[]);
    const tool = getTool({
      getWorkspaceRoot: () => "/ws",
      importEnvFiles,
    });
    await tool.handler({ files: [".env.example"], deleteAfter: true });
    expect(importEnvFiles).toHaveBeenCalledWith("/ws", {
      files: [".env.example"],
      deleteAfter: true,
      actor: "agent",
    });
  });

  it("defaults deleteAfter to false (autonomous actor must opt in)", async () => {
    const importEnvFiles = vi.fn(async () => [] as EnvFileImport[]);
    const tool = getTool({
      getWorkspaceRoot: () => "/ws",
      importEnvFiles,
    });
    await tool.handler({});
    expect(importEnvFiles).toHaveBeenCalledWith("/ws", {
      files: undefined,
      deleteAfter: false,
      actor: "agent",
    });
  });

  it("broadcasts secrets:changed only when something was imported", async () => {
    const notifySecretsChanged = vi.fn((_root: string) => {});
    const tool = getTool({
      getWorkspaceRoot: () => "/ws",
      importEnvFiles: vi.fn(async () => [importedResult(".env", ["A"])]),
      notifySecretsChanged,
    });
    await tool.handler({});
    expect(notifySecretsChanged).toHaveBeenCalledWith("/ws");

    const quietNotify = vi.fn((_root: string) => {});
    const quietTool = getTool({
      getWorkspaceRoot: () => "/ws",
      importEnvFiles: vi.fn(async () => [] as EnvFileImport[]),
      notifySecretsChanged: quietNotify,
    });
    await quietTool.handler({});
    expect(quietNotify).not.toHaveBeenCalled();
  });

  it("returns the per-file summary (names only)", async () => {
    const tool = getTool({
      getWorkspaceRoot: () => "/ws",
      importEnvFiles: vi.fn(async () => [
        importedResult(".env", ["A", "B"]),
        { file: ".env.local", error: "EACCES" } as EnvFileImport,
      ]),
    });
    const res = (await tool.handler({})) as { content: { text: string }[] };
    const parsed = JSON.parse(res.content[0]?.text ?? "") as EnvFileImport[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.result?.imported.map((m) => m.name)).toEqual(["A", "B"]);
    expect(parsed[1]?.error).toBe("EACCES");
  });
});

describe("plan_usage tool", () => {
  // Build the tool against getQuota/getUsageLedger spies so each test can
  // assert the read is forwarded verbatim (account usage metadata only).
  function getPlanUsageTool(deps: typeof baseDeps) {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, deps);
    const tool = tools.find((t) => t.name === "plan_usage");
    if (!tool) throw new Error("plan_usage tool not registered");
    return tool;
  }

  const QUOTA: QuotaStatus = {
    fiveHour: { usedPercentage: 91, resetsAt: 1_781_080_800 },
    sevenDay: { usedPercentage: 16, resetsAt: 1_781_370_000 },
    model: "Opus 4.8 (1M context)",
    updatedAt: 1_781_129_748,
    available: true,
  };
  const SESSIONS: SessionUsage[] = [
    {
      sessionId: "s-1",
      cwd: "/repo",
      model: "Opus 4.8 (1M context)",
      modelsSeen: ["Opus 4.8 (1M context)"],
      contextTokens: 118_300,
      contextWindowSize: 1_000_000,
      costUsd: 4.6,
      apiMs: 669_000,
      linesAdded: 39,
      linesRemoved: 26,
      lastEmitAt: 1_781_129_748,
      lastProgressAt: 1_781_129_748,
    },
  ];

  it("declares an empty input schema (no args)", () => {
    const tool = getPlanUsageTool(baseDeps);
    expect(tool.config.inputSchema).toEqual({});
  });

  it("returns meterEnabled + the quota and sessions from the deps, with NO workspace gate", async () => {
    const getQuota = vi.fn(() => QUOTA);
    const getUsageLedger = vi.fn(() => SESSIONS);
    const tool = getPlanUsageTool({
      ...baseDeps,
      // Account-wide read: getWorkspaceRoot() is null in baseDeps and the tool
      // must still answer (quota is not project state).
      prefsFile: "/tmp/airlock-test-prefs-plan-usage-absent.json",
      getQuota,
      getUsageLedger,
    });
    const res = (await tool.handler({})) as {
      content: [{ text: string }];
      isError?: boolean;
    };
    expect(getQuota).toHaveBeenCalledTimes(1);
    expect(getUsageLedger).toHaveBeenCalledTimes(1);
    expect(res.isError).toBeUndefined();
    const body = JSON.parse(res.content[0].text);
    // The prefs file does not exist, so loadPrefs falls back to DEFAULTS
    // (quotaMeter on by default).
    expect(body.meterEnabled).toBe(true);
    expect(body.quota).toEqual(QUOTA);
    expect(body.sessions).toEqual(SESSIONS);
  });

  it("returns quota: null and sessions: [] before any session has emitted", async () => {
    const tool = getPlanUsageTool({
      ...baseDeps,
      prefsFile: "/tmp/airlock-test-prefs-plan-usage-absent.json",
    });
    const res = (await tool.handler({})) as {
      content: [{ text: string }];
      isError?: boolean;
    };
    expect(res.isError).toBeUndefined();
    const body = JSON.parse(res.content[0].text);
    expect(body.quota).toBeNull();
    expect(body.sessions).toEqual([]);
  });
});

describe("list_secret_names tool", () => {
  it("echoes the root it answered for alongside the names", async () => {
    // The agent-core mock's listSecrets resolves [] (empty vault), so this
    // exercises the handler's shape without disk or keychain.
    const { mcp, tools } = fakeServer();
    registerTools(mcp, { ...baseDeps, getWorkspaceRoot: () => "/repo" });
    const tool = tools.find((t) => t.name === "list_secret_names");
    if (!tool) throw new Error("list_secret_names tool not registered");
    const res = (await tool.handler({})) as { content: [{ text: string }] };
    // The result names WHICH root it answered for (QA 2026-06-11: the tools
    // follow GUI focus, so the agent must be able to detect a focus change).
    expect(JSON.parse(res.content[0].text)).toEqual({
      root: "/repo",
      secrets: [],
    });
  });
});
