import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type {
  ActivityItem,
  Section,
  SectionVisibility,
} from "../../shared/ipc";
import { SECTIONS } from "../prefs";
import { registerTools, TOOL_NAMES } from "./tools";

// Mock agent-core's runCommand so the run_command handler tests can assert it is
// NOT invoked on the fail-closed (no-workspace) path. tools.ts imports runCommand
// directly (it does NOT inject it), so a module mock is the only seam. This also
// keeps the test from resolving/injecting real secrets or spawning a process.
const runCommandMock = vi.fn();
vi.mock("@airlock/agent-core", () => ({
  runCommand: (...args: unknown[]) => runCommandMock(...args),
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
};

describe("registerTools allowlist guard", () => {
  // The core security gate: the registered tool set is LOCKED to exactly the
  // fourteen allowlisted tools. A 15th tool (e.g. a future secret-value
  // drill-down) or a removed one fails this immediately.
  it("registers exactly the fourteen allowlisted tools and nothing else", () => {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, baseDeps);

    const registered = tools.map((t) => t.name).sort();
    expect(registered).toEqual([...TOOL_NAMES].sort());
    expect(registered).toHaveLength(14);
    expect(registered).toContain("run_command");
    expect(registered).toContain("request_secret");
    expect(registered).toContain("activity_status");
    expect(registered).toContain("dismiss_activity");
  });

  it("registers no duplicate tool names", () => {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, baseDeps);
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
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
    expect(JSON.parse(res.content[0].text)).toEqual(items);
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
