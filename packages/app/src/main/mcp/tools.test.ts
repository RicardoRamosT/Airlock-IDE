import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { Section, SectionVisibility } from "../../shared/ipc";
import { SECTIONS } from "../prefs";
import { registerTools, TOOL_NAMES } from "./tools";

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
};

describe("registerTools allowlist guard", () => {
  // The core security gate: the registered tool set is LOCKED to exactly the
  // nine v1 tools. A 10th tool (e.g. a future secret-value drill-down) or a
  // removed one fails this immediately.
  it("registers exactly the nine allowlisted tools and nothing else", () => {
    const { mcp, tools } = fakeServer();
    registerTools(mcp, baseDeps);

    const registered = tools.map((t) => t.name).sort();
    expect(registered).toEqual([...TOOL_NAMES].sort());
    expect(registered).toHaveLength(9);
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
