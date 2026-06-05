// The v1 airlock MCP tool set: read-status tools plus the single UI-control
// tool. Every tool is a THIN wrapper over the shared read layer (main/ide-state)
// or main/menu's changeSectionVisibility -- there is no business logic here, only
// argument plumbing and the SDK result shape.
//
// SECURITY INVARIANT (enforced by tools.test.ts): no tool returns a secret
// value. This module imports ONLY ide-state read functions + the visibility
// funnel and deliberately references NONE of the value-returning broker/secret
// functions. ide-state already guarantees its outputs are redacted/metadata-only;
// the tools just forward those shapes. A source-level test asserts that none of
// the forbidden value-returning identifiers appear anywhere in this file, so a
// future edit that wires one into a tool fails CI. (The names are listed in the
// test, not here, so this comment cannot itself trip that substring check.)
//
// ASCII-only comments: this module is CJS-bundled into the Electron main process
// and Electron's cjs_lexer crashes on multibyte characters.
import { runCommand } from "@airlock/agent-core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Section, SectionVisibility } from "../../shared/ipc";
import * as ide from "../ide-state";
import { changeSectionVisibility } from "../menu";
import { SECTIONS } from "../prefs";

// The exact, locked v1 tool set. tools.test.ts asserts the registered names
// equal this list, so a 10th tool or a missing one fails the allowlist guard.
export const TOOL_NAMES: string[] = [
  "list_sidebar_sections",
  "set_sidebar_section_visibility",
  "database_status",
  "docker_status",
  "neon_status",
  "render_services",
  "git_status",
  "host_status",
  "list_secret_names",
  "run_command",
];

// Dependencies registerTools needs to reach app state. changeVisibility is
// injectable (defaulting to the real menu funnel) so the guard test can spy on
// it without standing up Electron's BrowserWindow; production passes nothing.
export interface ToolDeps {
  prefsFile: string;
  getWorkspaceRoot: () => string | null;
  getBaseEnv: () => Record<string, string>;
  changeVisibility?: (
    prefsFile: string,
    id: Section,
    visible: boolean,
  ) => Promise<SectionVisibility>;
}

// Wrap any JSON-able result in the SDK text-content shape the ping tool uses.
function ok(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

// A clean tool error (e.g. no workspace open): a text content flagged isError so
// the client surfaces it as a failure rather than data.
function err(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

const NO_WORKSPACE = "No workspace open";

// Register the v1 tools onto the live McpServer. Called once at startup from
// startMcpServer. Each handler forwards to an ide-state read or the visibility
// funnel and never touches secret values.
export function registerTools(mcp: McpServer, deps: ToolDeps): void {
  const changeVisibility = deps.changeVisibility ?? changeSectionVisibility;

  // --- App-global reads (no workspace root needed) -----------------------

  mcp.registerTool(
    "list_sidebar_sections",
    { description: "List sidebar sections with their visibility." },
    async () => ok(await ide.listSidebarSections(deps.prefsFile)),
  );

  mcp.registerTool(
    "docker_status",
    { description: "Report Docker engine and container status." },
    async () => ok(await ide.dockerStatus()),
  );

  mcp.registerTool(
    "neon_status",
    {
      description:
        "Report Neon connection state and its projects when connected.",
    },
    async () => {
      const connected = (await ide.neonStatus()).connected;
      const projects = connected ? await ide.neonProjects() : [];
      return ok({ connected, projects });
    },
  );

  // render handles a null root itself (it falls back to all matching services).
  mcp.registerTool(
    "render_services",
    { description: "List Render services with their deploy state." },
    async () => ok(await ide.renderServicesStatus(deps.getWorkspaceRoot())),
  );

  // --- The single UI-control tool ----------------------------------------

  mcp.registerTool(
    "set_sidebar_section_visibility",
    {
      description: "Show or hide a sidebar section; returns the new map.",
      inputSchema: {
        section: z.enum(SECTIONS as [Section, ...Section[]]),
        visible: z.boolean(),
      },
    },
    async ({ section, visible }) => {
      // Defense in depth: the zod enum already rejects unknown sections, but
      // re-check against the canonical list so a bogus value is a clean error
      // even if the schema is ever bypassed.
      if (!SECTIONS.includes(section)) {
        return err(`Unknown section: ${section}`);
      }
      return ok(await changeVisibility(deps.prefsFile, section, visible));
    },
  );

  // --- Workspace-rooted reads (require an open workspace) -----------------

  mcp.registerTool(
    "database_status",
    {
      description:
        "List vaulted databases with redacted info and reachability.",
    },
    async () => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      return ok(await ide.databaseStatus(root));
    },
  );

  mcp.registerTool(
    "git_status",
    { description: "Report the working-tree git status for the workspace." },
    async () => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      return ok(await ide.gitStatusFor(root));
    },
  );

  mcp.registerTool(
    "host_status",
    { description: "Report the local dev server URL and reachability." },
    async () => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      return ok(await ide.hostStatus(root));
    },
  );

  mcp.registerTool(
    "list_secret_names",
    {
      description: "List secret names with provider and validity (no values).",
    },
    async () => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      return ok(await ide.listSecretNames(root));
    },
  );

  // The single side-effecting tool: runs a shell command with named vaulted
  // secrets injected into its env, then returns the output with every injected
  // value redacted. The secret RESOLUTION + injection + redaction all happen
  // inside runCommand (agent-core) -- this handler never touches a secret value,
  // so the source-guard stays green. On the fail-closed path runCommand throws
  // an Error whose message is name-only (never a value), so surfacing it is safe.
  mcp.registerTool(
    "run_command",
    {
      description:
        "Run a shell command with the named vaulted secrets injected into its environment; the output is returned with secret values redacted. Use this for commands that need a secret (database, API keys) -- you never see the secret value.",
      inputSchema: {
        command: z.string(),
        injectSecrets: z.array(z.string()).optional(),
        cwd: z.string().optional(),
      },
    },
    async ({ command, injectSecrets, cwd }) => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      try {
        return ok(
          await runCommand(root, command, {
            injectSecrets,
            cwd,
            baseEnv: deps.getBaseEnv(),
          }),
        );
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );
}
