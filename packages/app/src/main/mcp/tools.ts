// The airlock MCP tool set: read-status tools, the UI-curate tools (sidebar
// visibility + activity dismiss), the command runner, and the request-secret
// prompt. Every tool is a THIN wrapper over the shared read layer
// (main/ide-state), the activity feed, main/menu's changeSectionVisibility, or an
// injected resolver -- there is no business logic here, only argument plumbing
// and the SDK result shape.
//
// SECURITY INVARIANT (enforced by tools.test.ts): no tool returns a secret
// value. This module imports ide-state read functions, the visibility funnel,
// and the value-free secret-scan/commit orchestrators (scanWorkingSet /
// guardedCommit -- their results carry secret NAMES + locations, never VALUES),
// and deliberately references NONE of the value-returning broker/secret
// functions. ide-state already guarantees its outputs are redacted/metadata-only;
// the tools just forward those shapes. A source-level test asserts that none of
// the forbidden value-returning identifiers appear anywhere in this file, so a
// future edit that wires one into a tool fails CI. (The names are listed in the
// test, not here, so this comment cannot itself trip that substring check.)
//
// ASCII-only comments: this module is CJS-bundled into the Electron main process
// and Electron's cjs_lexer crashes on multibyte characters.
import path from "node:path";
import { appendAudit, gateCommand, runCommand } from "@airlock/agent-core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  ActivityItem,
  AgentCommand,
  AgentCommandResult,
  EnvFileImport,
  QuotaStatus,
  Section,
  SectionVisibility,
  SessionUsage,
  TerminalInputResult,
} from "../../shared/ipc";
import { queryEvents } from "../eventlog/wire";
import { ensureIdentityFor } from "../github/account";
import * as ide from "../ide-state";
import { changeSectionVisibility } from "../menu";
import { loadPrefs, SECTIONS } from "../prefs";
import { guardedCommit } from "../secrets/commit";
import { scanWorkingSet } from "../secrets/scan";

// The exact, locked tool set. tools.test.ts asserts the registered names equal
// this list, so an extra tool or a missing one fails the allowlist guard. The
// last nine are the IDE-control tools: they drive the focused window's tab/
// split/terminal/page-tab layout and carry only ids/paths/page names in +
// layout metadata out -- NO secret value, so the source-guard / redactor are
// untouched by them. plan_usage reads the account's Claude plan usage (the
// quota meter / Usage dashboard data) -- usage metadata only, same invariant.
export const TOOL_NAMES: string[] = [
  "list_sidebar_sections",
  "set_sidebar_section_visibility",
  "database_status",
  "docker_status",
  "neon_status",
  "render_services",
  "git_status",
  "git_commit",
  "host_status",
  "list_secret_names",
  "run_command",
  "request_secret",
  "import_env",
  "get_terminal_tail",
  "send_terminal_input",
  "activity_status",
  "dismiss_activity",
  "plan_usage",
  "list_tabs",
  "open_tab",
  "close_tab",
  "switch_tab",
  "split_view",
  "open_terminal",
  "close_terminal",
  "open_app_page",
  "close_app_page",
  "project_info",
  "read_events",
];

// Dependencies registerTools needs to reach app state. changeVisibility is
// injectable (defaulting to the real menu funnel) so the guard test can spy on
// it without standing up Electron's BrowserWindow; production passes nothing.
export interface ToolDeps {
  prefsFile: string;
  getWorkspaceRoot: () => string | null;
  getBaseEnv: () => Record<string, string>;
  requestSecretFromUser: (
    name: string,
    providerHint?: string,
  ) => Promise<{ vaulted: boolean; timedOut?: boolean; busy?: boolean }>;
  // Batch-import env files into the vault for import_env (production wires
  // agent-core's importAllDotEnv in server.ts; tests inject a fake). Returns
  // per-file summaries carrying secret NAMES only -- never a value -- so the
  // source-guard stays green. actor:"agent" keeps the audit chain honest.
  importEnvFiles: (
    root: string,
    opts: {
      deleteAfter?: boolean;
      files?: string[];
      actor?: "user" | "agent";
    },
  ) => Promise<EnvFileImport[]>;
  // Broadcast that a project's secrets changed (main-side import), so every
  // window's SECRETS section refetches live. Carries only the root path.
  notifySecretsChanged: (root: string) => void;
  getTerminalTail: (
    termId: string,
    lines: number,
  ) => Promise<{ tail: string } | { error: string }>;
  listTerminals: () => Promise<{ id: string; preview: string }[]>;
  // Gated terminal input for send_terminal_input: writes agent input into a live
  // pty AFTER a one-time per-terminal user grant (modal). Returns a value-free
  // outcome (sent/denied/timedOut/busy/error) -- never terminal output or a
  // secret -- so this dep keeps the source-guard green.
  sendTerminalInput: (
    terminalId: string,
    data: string,
  ) => Promise<TerminalInputResult>;
  // The focused project's Activity feed (CI/Render/Docker), already filtered of
  // dismissed ids (activityStatus self-filters). Status metadata only -- no
  // secret values, consistent with the other status reads.
  getActivity: (root: string | null) => Promise<ActivityItem[]>;
  // Dismiss an Activity entry by id: add it to the app-global dismissed set and
  // broadcast so the UI refetches the filtered feed live. Carries an opaque id,
  // never a secret value. Sync (it mutates the in-memory set + fans out).
  dismissActivity: (entryId: string) => void;
  // The account's Claude plan usage for plan_usage: main's cached QuotaStatus
  // (null until a session emits) and the per-session ledger the Usage dashboard
  // shows (busiest-first). Usage metadata only -- percentages, costs, paths --
  // never a secret value, so these deps keep the source-guard green.
  getQuota: () => QuotaStatus | null;
  getUsageLedger: () => SessionUsage[];
  // Drive the focused window's tab/split/terminal layout for the IDE-control
  // tools. Sends an AgentCommand to the focused window and resolves the resulting
  // layout metadata (or an error result). Carries ids/paths in + names/titles out
  // -- NEVER a secret value, so this dep keeps the source-guard green. Never
  // throws (a no-window / timeout / renderer error resolves { ok:false }).
  runAgentCommand: (cmd: AgentCommand) => Promise<AgentCommandResult>;
  changeVisibility?: (
    prefsFile: string,
    id: Section,
    visible: boolean,
  ) => Promise<SectionVisibility>;
  // The detected ProjectProfile + .airlock/overview.md text for a root, value-free
  // (tech/service names from manifests/config + secret NAMES, never values).
  getProjectInfo: (root: string) => Promise<unknown>;
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

// Exported so tools.events.test.ts can unit-test the mapping without standing
// up the MCP server. Delegates entirely to queryEvents; no business logic here.
export async function eventsToolHandler(args: {
  level?: string;
  category?: string;
  op?: string;
  project?: string;
  since?: string;
  limit?: number;
}): Promise<{ content: [{ type: "text"; text: string }] }> {
  const events = await queryEvents(args as Parameters<typeof queryEvents>[0]);
  return { content: [{ type: "text" as const, text: JSON.stringify(events) }] };
}

// Register the v1 tools onto the live McpServer. Called once at startup from
// startMcpServer. Each handler forwards to an ide-state read, the visibility
// funnel, the command runner, or the request-secret resolver, and never touches
// a secret value (request_secret resolves only a boolean outcome).
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
      // Resolve the focused project's Neon account (multi-account: each project
      // binds its own key).
      const root = deps.getWorkspaceRoot();
      const connected = (await ide.neonStatus(root)).connected;
      if (!connected) return ok({ connected, projects: [] });
      // Org-based account: aggregate projects across every org the key can see.
      // A project-scoped key can't list orgs (404) -> report connected, no
      // projects, rather than failing the tool.
      let projects: Awaited<ReturnType<typeof ide.neonProjects>> = [];
      try {
        const orgs = await ide.neonOrganizations(root);
        projects = (
          await Promise.all(orgs.map((o) => ide.neonProjects(root, o.id)))
        ).flat();
      } catch {
        projects = [];
      }
      return ok({ connected, projects });
    },
  );

  // render handles a null root itself (it falls back to all matching services).
  mcp.registerTool(
    "render_services",
    { description: "List Render services with their deploy state." },
    async () => ok(await ide.renderServicesStatus(deps.getWorkspaceRoot())),
  );

  // The aggregated Activity feed. Like render_services it handles a null root
  // itself (CI is skipped with no folder; render/docker still report), and the
  // dep self-filters dismissed ids so this read reflects dismissals. Returns the
  // same ActivityItem[] the sidebar shows -- status metadata only, no secrets.
  mcp.registerTool(
    "activity_status",
    {
      description:
        "List the Activity feed for the focused project: in-progress CI runs, Render deploys, and Docker containers, with their state and a stable entry id. Status metadata only -- no secret values. The result's `root` field names which project (null = none focused) it answered for, so check it when the user may have switched tabs.",
      inputSchema: {},
    },
    async () => {
      // Echo WHICH root this answered for (QA 2026-06-11; see list_secret_names).
      const root = deps.getWorkspaceRoot();
      return ok({ root, activity: await deps.getActivity(root) });
    },
  );

  // The account's Claude plan usage: the 5h/7d rate-limit windows the quota
  // meter shows plus the per-session ledger behind the Usage dashboard. App-
  // global (the data is account-wide, fed by ANY Claude session on the machine,
  // not project state). meterEnabled lets the agent tell "feature off" from
  // "no session emitting yet"; quota.updatedAt is the freshness signal (an old
  // stamp means no live session is feeding the meter). Usage metadata only --
  // percentages, reset times, costs, cwds -- never a secret value.
  mcp.registerTool(
    "plan_usage",
    {
      description:
        "Read the account's Claude plan usage: the 5-hour and 7-day rate-limit windows (percent used + reset time) and a per-session usage breakdown (project cwd, model, current context size, cumulative API time / cost / lines, busiest first). quota is null until a Claude session emits usage; sessions cover this app run. Usage metadata only -- no secret values.",
      inputSchema: {},
    },
    async () => {
      const prefs = await loadPrefs(deps.prefsFile);
      return ok({
        meterEnabled: prefs.quotaMeter.enabled,
        quota: deps.getQuota(),
        sessions: deps.getUsageLedger(),
      });
    },
  );

  // --- The UI-control / curate tools -------------------------------------

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

  // Curate the Activity feed: hide one entry by its id (from activity_status).
  // The dep adds the id to the app-global dismissed set and broadcasts, so the
  // UI updates live exactly like the activity:dismiss IPC path. The id is opaque
  // ("ci:<sha>" / "render:<id>" / "docker:<id>") -- no secret value crosses here.
  mcp.registerTool(
    "dismiss_activity",
    {
      description:
        "Dismiss an Activity entry by its id (from activity_status) so it disappears from the Activity panel. A later run/deploy with a new id reappears.",
      inputSchema: { entryId: z.string() },
    },
    async ({ entryId }) => {
      deps.dismissActivity(entryId);
      return ok({ dismissed: entryId });
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

  // Query the AirLock event log: lifecycle, integration calls, agent commands,
  // IPC, and errors. Secret-free by construction (Task 4 / capture.ts strips
  // values); this handler returns the result as-is. App-global (no workspace
  // gate): events span the entire app process, not just one project.
  mcp.registerTool(
    "read_events",
    {
      description:
        "Query AirLock's debugging event log (lifecycle, integration calls, agent commands, IPC, errors). Secret-free. Filters: level (min), category, op (prefix), project, since (ISO), limit (last N).",
      inputSchema: {
        level: z.enum(["debug", "info", "warn", "error"]).optional(),
        category: z.string().optional(),
        op: z.string().optional(),
        project: z.string().optional(),
        since: z.string().optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    async (args) => eventsToolHandler(args),
  );

  mcp.registerTool(
    "git_status",
    {
      description:
        "Report the working-tree git status for the workspace, including any files whose content contains a suspected secret value (secretLeaks: name/type + path:line, never the value).",
    },
    async () => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      const status = await ide.gitStatusFor(root);
      return ok({ ...status, secretLeaks: await scanWorkingSet(root) });
    },
  );

  // Commit the staged changes, but first scan the staged content for secret
  // values/patterns. If any are suspected the commit is BLOCKED and the leak
  // locations (name/type + path:line, never the value) are returned so the agent
  // can surface them and decide -- re-call with confirm:true to commit anyway.
  // guardedCommit returns a value-free CommitOutcome; this handler never sees a
  // secret value, so the source-guard stays green.
  mcp.registerTool(
    "git_commit",
    {
      description:
        "Commit the staged changes. If the staged content contains a suspected secret value the commit is BLOCKED and the leak locations are returned (name/type + path:line, never the value) -- tell the user, then re-call with confirm:true to commit anyway.",
      inputSchema: {
        message: z.string(),
        confirm: z.boolean().optional(),
      },
    },
    async ({ message, confirm }) => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      await ensureIdentityFor(root); // author agent commits as the project's account
      try {
        return ok(await guardedCommit(root, message, { gated: true, confirm }));
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
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
      description:
        "List secret names with provider and validity (no values). Acts on the FOCUSED project; the result's `root` field names which project it answered for, so check it when the user may have switched tabs.",
    },
    async () => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      // Echo WHICH root this answered for (QA 2026-06-11): these reads follow
      // GUI focus, so without the echo an agent asking about project A while
      // the user focuses project B gets B's answer with no way to notice.
      return ok({ root, secrets: await ide.listSecretNames(root) });
    },
  );

  mcp.registerTool(
    "project_info",
    {
      description:
        "Report the focused project's detected technologies and services (names + " +
        "categories, with the signal that detected each) plus the prose project " +
        "overview (.airlock/overview.md) when present. Metadata only -- no secret " +
        "values. Use it to understand the stack/layout without re-scanning the tree.",
    },
    async () => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      return ok({ root, ...((await deps.getProjectInfo(root)) as object) });
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
        'Run a shell command with the named vaulted secrets injected into its environment; the output is returned with secret values redacted. If the command hits a risky category under the user\'s agent policy it is BLOCKED (action="ask" -> re-call with confirm:true to proceed; action="block" -> not allowed, the user must change the policy). You never see the secret value.',
      inputSchema: {
        command: z.string(),
        injectSecrets: z.array(z.string()).optional(),
        cwd: z.string().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({ command, injectSecrets, cwd, confirm }) => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      const policy = (await loadPrefs(deps.prefsFile)).agentPolicy;
      const gate = gateCommand(command, policy, confirm ?? false);
      if (!gate.run) {
        await appendAudit(root, "agent", "command.policy.blocked", {
          action: gate.action,
          categories: gate.categories,
        }).catch(() => {});
        return ok({
          blocked: true,
          action: gate.action,
          categories: gate.categories,
          reason: gate.reason,
        });
      }
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

  // Batch-import the project's .env files into the vault. Discovery, parsing,
  // vaulting, per-file deletion, and auditing all live in agent-core behind
  // deps.importEnvFiles; the result carries secret NAMES only (never values),
  // so the source-guard invariant holds. deleteAfter defaults to FALSE here:
  // a button click is explicit user consent, an autonomous actor is not.
  // actor is hardcoded to "agent" (never caller-supplied) so audit
  // attribution is a property of the call path, not of tool input.
  mcp.registerTool(
    "import_env",
    {
      description:
        "Import the project's .env files into the secret vault (batch). With no args it discovers and imports every importable env file in the project root (.env and .env.*, excluding templates: *.example, *.sample, *.template, *.dist, *.vault) in precedence order (.env first, *.local last -- on duplicate keys the LAST write wins). Pass files (relative paths) to import exactly those instead, in the order given (later files override earlier ones on duplicate keys). Returns per-file summaries with secret NAMES only -- you never see a value. deleteAfter defaults to false: only pass true when the user explicitly confirmed deleting the source files after vaulting (a file is deleted only if every entry in it vaulted cleanly).",
      inputSchema: {
        files: z.array(z.string()).optional(),
        deleteAfter: z.boolean().optional(),
      },
    },
    async ({ files, deleteAfter }) => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      try {
        const results = await deps.importEnvFiles(root, {
          files,
          deleteAfter: deleteAfter === true,
          actor: "agent",
        });
        if (results.some((r) => (r.result?.imported.length ?? 0) > 0)) {
          deps.notifySecretsChanged(root);
        }
        return ok(results);
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );

  // Read the recent output of a terminal tab so the agent can see what the user
  // is running (dev server, build, tests, logs). No terminalId -> list terminals
  // (id + redacted preview); with terminalId -> that terminal's redacted tail.
  // Resolution + redaction live behind the deps (getTerminalTail/listTerminals),
  // so this handler references no value-returning identifier (source-guard green).
  mcp.registerTool(
    "get_terminal_tail",
    {
      description:
        "Read the recent output (tail) of a terminal tab so you can see what the user is running (dev server, build, tests, logs). Call with no terminalId to list terminals (each with a short preview); call with a terminalId to get that terminal's recent output. terminalId is the PTY session id -- the `ptyId` field from list_tabs, or the `id` this tool returns when called with no terminalId (NOT list_tabs' layout `id`). Secret values are redacted -- you never see them.",
      inputSchema: {
        terminalId: z.string().optional(),
        lines: z.number().optional(),
      },
    },
    async ({ terminalId, lines }) => {
      if (!deps.getWorkspaceRoot()) return err(NO_WORKSPACE);
      if (!terminalId) return ok(await deps.listTerminals());
      const res = await deps.getTerminalTail(terminalId, lines ?? 40);
      return "error" in res ? err(res.error) : ok(res);
    },
  );

  // Write input into a RUNNING terminal (drive a live Claude session, answer an
  // interactive prompt, send a keystroke). Gated by a one-time per-terminal user
  // grant (a modal); the grant + write live behind deps.sendTerminalInput, which
  // returns a value-free outcome -- this handler references no value-returning
  // identifier, so the source-guard stays green.
  mcp.registerTool(
    "send_terminal_input",
    {
      description:
        'Send input to a RUNNING terminal: type a prompt into a live Claude session, answer an interactive prompt, or send a keystroke. terminalId is the PTY session id -- the `ptyId` from list_tabs (the same id get_terminal_tail takes, NOT the layout id). data is written verbatim: include "\\n" to submit a line, "\\u0003" for Ctrl-C. The FIRST send to a terminal opens a one-time approval modal in the IDE and waits for the user; once approved, later sends to that terminal proceed without a prompt for the rest of the session. Returns { sent } on success, or { denied } / { timedOut } / { busy } when approval did not complete. You never see the terminal output or its secret values.',
      inputSchema: {
        terminalId: z.string(),
        data: z.string(),
      },
    },
    async ({ terminalId, data }) => {
      const r = await deps.sendTerminalInput(terminalId, data);
      return r.error ? err(r.error) : ok(r);
    },
  );

  // Ask the user to vault a secret the agent needs. This opens a secure prompt
  // in the IDE (main -> renderer modal); the value flows user -> keychain and
  // NEVER through this handler. The dep resolves only a boolean outcome, so the
  // source-guard stays green -- this references no value-returning identifier.
  mcp.registerTool(
    "request_secret",
    {
      description:
        "Ask the user to vault a secret you need (opens a secure prompt in the IDE). Returns only whether it was vaulted -- you never see the value. Use this after a tool reports a secret is not vaulted, then retry.",
      inputSchema: {
        name: z.string(),
        providerHint: z.string().optional(),
      },
    },
    async ({ name, providerHint }) => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      return ok(await deps.requestSecretFromUser(name, providerHint));
    },
  );

  // --- IDE-control tools: drive the FOCUSED window's layout ---------------
  // Each forwards an AgentCommand to deps.runAgentCommand (the main->renderer
  // command round-trip) and maps the result: ok -> the fresh TabsSnapshot,
  // !ok -> a clean error (no window / timed out / renderer error). They carry
  // only tab/terminal ids + a folder path in, and layout metadata (tab names +
  // terminal titles) out -- NO secret value, so they reference no value-returning
  // identifier and the source-guard stays green. NO workspace gate: layout
  // control applies to any window, including a blank-tab one. runAgentCommand
  // never throws, so a degraded call surfaces as a clean tool error.

  // Run a command and return its result as the SDK shape (data on ok, error on !ok).
  const drive = async (cmd: AgentCommand) => {
    const r = await deps.runAgentCommand(cmd);
    return r.ok ? ok(r.data) : err(r.error);
  };

  mcp.registerTool(
    "list_tabs",
    {
      description:
        "List the open tabs in the focused airlock window: each tab's id, name, root, whether it is focused / in the split, and its terminals (id + ptyId + title), plus the split pair. A terminal's `id` is the layout id (use with open_terminal/close_terminal); its `ptyId` is the pty session id (use with get_terminal_tail). Layout metadata only -- no secret values. Use it to see the current layout before driving it.",
      inputSchema: {},
    },
    async () => drive({ type: "list_tabs" }),
  );

  mcp.registerTool(
    "open_tab",
    {
      description:
        "Open a project folder as a new tab (pass path), or a blank tab with no folder (no path), in the focused airlock window. The new tab is focused, and -- like every tab and split pane -- comes with one default terminal already running (so list_tabs will show 1 terminal, not 0). Returns the new tab layout. Acts on the FOCUSED window. The folder must be one the user has already opened (a current or recent project, or a subfolder of one) -- to open a brand-new location, ask the user to open it.",
      inputSchema: { path: z.string().optional() },
    },
    async ({ path: tabPath }) => {
      // CONFINE the agent's open path. Without this, open_tab -> workspace:open
      // sets the window root to ANY path with no validation, and the renderer
      // then reports it to workspace:roots -- self-poisoning the resolveRoot
      // allowlist so every root-gated tool (run_command, git_*, ...) operates in
      // the attacker-chosen directory. The agent may only open a project the USER
      // has sanctioned: a current/recent root or a subfolder of one (recents is a
      // superset of every opened root). The human's brand-new opens go through
      // dialog:openFolder, so this does not constrain the user. (audit PB-C1)
      if (tabPath !== undefined) {
        const resolved = path.resolve(tabPath);
        const focused = deps.getWorkspaceRoot();
        const allowed = [
          ...(await loadPrefs(deps.prefsFile)).recentFolders,
          ...(focused ? [focused] : []),
        ].map((p) => path.resolve(p));
        const ok = allowed.some(
          (a) => resolved === a || resolved.startsWith(a + path.sep),
        );
        if (!ok) {
          return err(
            `open_tab can only open a folder the user has already opened (a current or recent project, or a subfolder of one); "${tabPath}" is not one. Ask the user to open it first.`,
          );
        }
      }
      return drive({ type: "open_tab", path: tabPath });
    },
  );

  mcp.registerTool(
    "close_tab",
    {
      description:
        "Close a tab by its id (from list_tabs) in the focused airlock window; returns the resulting layout. Closing the last tab leaves a fresh blank tab. Acts on the FOCUSED window.",
      inputSchema: { tabId: z.string() },
    },
    async ({ tabId }) => drive({ type: "close_tab", tabId }),
  );

  mcp.registerTool(
    "switch_tab",
    {
      description:
        "Focus a tab by its id (from list_tabs) in the focused airlock window; returns the resulting layout. Acts on the FOCUSED window.",
      inputSchema: { tabId: z.string() },
    },
    async ({ tabId }) => drive({ type: "switch_tab", tabId }),
  );

  mcp.registerTool(
    "split_view",
    {
      description:
        "Toggle the split view in the focused airlock window. With a tabId, split the focused tab beside that tab. Pass anchorTabId too to make THAT tab the left/primary instead of the focused one -- naming BOTH ids splits exactly that pair regardless of which tab is focused (recommended: it stays correct even if focus changes between your calls). With no tabId, either collapse the split if it is already showing, or create a new blank secondary tab beside the focused one -- no folder, but (like every tab/pane) with one default terminal already running, so a freshly-split pane shows 1 terminal, not 0. Returns the resulting layout. Acts on the FOCUSED window.",
      inputSchema: {
        tabId: z.string().optional(),
        anchorTabId: z.string().optional(),
      },
    },
    async ({ tabId, anchorTabId }) =>
      drive({ type: "split_view", tabId, anchorTabId }),
  );

  mcp.registerTool(
    "open_terminal",
    {
      description:
        "Open a new terminal in the focused airlock window. With a tabId, open it in that tab (it is focused first); with no tabId, open it in the focused tab. Returns the resulting layout (the tab's terminals include the new one). Spawns a shell with the project's secrets injected -- but exposes NO env values. Acts on the FOCUSED window.",
      inputSchema: { tabId: z.string().optional() },
    },
    async ({ tabId }) => drive({ type: "open_terminal", tabId }),
  );

  mcp.registerTool(
    "close_terminal",
    {
      description:
        "Close a terminal by its id (from list_tabs / open_terminal) in the focused airlock window; returns the resulting layout. Acts on the FOCUSED window.",
      inputSchema: { terminalId: z.string() },
    },
    async ({ terminalId }) => drive({ type: "close_terminal", terminalId }),
  );

  // The IDE page-tabs (Settings / Usage): app chrome beside the project tabs.
  // Both can be open at once and at most one is SHOWN; the snapshot's appPages
  // reports {open, shown}. Open also un-hides an already-open page; closing a
  // page that is not open is a clean no-op. Page names only -- no value surface.
  mcp.registerTool(
    "open_app_page",
    {
      description:
        'Open an IDE page-tab ("settings" or "usage") in the focused airlock window and show it. The page-tabs sit beside the project tabs (see list_tabs\' appPages); opening an already-open page brings it back into view. Returns the resulting layout. Acts on the FOCUSED window.',
      inputSchema: { page: z.enum(["settings", "usage"]) },
    },
    async ({ page }) => drive({ type: "open_app_page", page }),
  );

  mcp.registerTool(
    "close_app_page",
    {
      description:
        'Close an IDE page-tab ("settings" or "usage") in the focused airlock window. Closing a page that is not open is a no-op. Returns the resulting layout. Acts on the FOCUSED window.',
      inputSchema: { page: z.enum(["settings", "usage"]) },
    },
    async ({ page }) => drive({ type: "close_app_page", page }),
  );
}
