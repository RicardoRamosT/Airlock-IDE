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
  AgentCommand,
  AgentCommandResult,
  CiRun,
  DevServerStartResult,
  DevServerState,
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
import { MAX_BULK } from "../overview/journal";
import { isSectionId, loadPrefs } from "../prefs";
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
  "extension_status",
  "extension_connect",
  "git_status",
  "git_commit",
  "host_status",
  "list_secret_names",
  "run_command",
  "request_secret",
  "import_env",
  "get_terminal_tail",
  "send_terminal_input",
  "ci_status",
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
  "start_dev_server",
  "stop_dev_server",
  "slack_list_allowed_channels",
  "slack_read_channel",
  "github_read_issue",
  "capture_screenshot",
  "set_pref",
  "add_changelog_entries",
  "update_changelog_notes",
];

// An extension's own resources, from the SAME readers the per-product tools
// used before they were merged into extension_status -- so folding three tools
// into one lost no capability. An extension with nothing to list (Slack,
// GitHub, and the manifest integrations) answers null rather than an empty
// array, which would imply "connected but empty".
async function extensionResources(
  id: string,
  root: string | null,
): Promise<unknown> {
  if (id === "docker") return await ide.dockerStatus();
  if (id === "render") return await ide.renderServicesStatus(root);
  if (id === "neon") {
    // Resolve the focused project's Neon account (multi-account: each project
    // binds its own key).
    const connected = (await ide.neonStatus(root)).connected;
    if (!connected) return { connected, projects: [] };
    // Org-based account: aggregate projects across every org the key can see.
    // A project-scoped key can't list orgs (404) -> report connected, no
    // projects, rather than failing the tool.
    try {
      const orgs = await ide.neonOrganizations(root);
      const projects = (
        await Promise.all(orgs.map((o) => ide.neonProjects(root, o.id)))
      ).flat();
      return { connected, projects };
    } catch {
      return { connected, projects: [] };
    }
  }
  return null;
}

// Dependencies registerTools needs to reach app state. changeVisibility is
// injectable (defaulting to the real menu funnel) so the guard test can spy on
// it without standing up Electron's BrowserWindow; production passes nothing.
export interface ToolDeps {
  prefsFile: string;
  getWorkspaceRoot: () => string | null;
  // The Extension Hub inventory (ipc.ts's listExtensionsForAgent). Shared with
  // the hub rather than re-derived, so the agent's picture of what is connected
  // cannot drift from the user's.
  listExtensions: (
    root: string | null,
  ) => Promise<import("@airlock/agent-core").ExtensionSummary[]>;
  // Self-verification toolkit (opt-in): the gate + the two power tools' backends.
  selfVerifyEnabled: () => Promise<boolean>;
  captureScreenshot: () => Promise<string | null>; // base64 PNG of the focused window
  setPref: (
    key: string,
    value: unknown,
  ) => Promise<{ ok: boolean; error?: string }>;
  // Bulk Changelog writes: one read + write + refresh broadcast per batch.
  addChangelogEntries: (
    root: string,
    entries: unknown,
  ) => Promise<
    | {
        ok: true;
        added: number;
        skipped: number;
        entries: import("../../shared/ipc").JournalEntry[];
      }
    | { ok: false; error: string }
  >;
  updateChangelogNotes: (
    root: string,
    updates: unknown,
  ) => Promise<
    | { ok: true; updated: number; skipped: number }
    | { ok: false; error: string }
  >;
  getBaseEnv: () => Record<string, string>;
  requestSecretFromUser: (
    name: string,
    providerHint: string | undefined,
    root: string | null,
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
  // Terminal deps now take an explicit root so the terminal list and tail are
  // scoped to the calling session's project, not GUI focus. root null means no
  // project -> getTerminalTail returns an error, listTerminals returns [].
  getTerminalTail: (
    termId: string,
    lines: number,
    root: string | null,
  ) => Promise<{ tail: string } | { error: string }>;
  listTerminals: (
    root: string | null,
  ) => Promise<{ id: string; preview: string }[]>;
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
  getCiRun: (
    root: string | null,
  ) => Promise<{ branch: string; run: CiRun } | null>;
  // Dismiss an Activity entry by id: add it to the app-global dismissed set and
  // broadcast so the UI refetches the filtered feed live. Carries an opaque id,
  // never a secret value. Sync (it mutates the in-memory set + fans out).
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
  // Managed dev-server deps for start_dev_server/stop_dev_server: status
  // metadata only (status/url/port/terminalId/command/startedBy/exitCode) --
  // never a secret value. start takes no arbitrary command: it runs the
  // project's dev command -- the configured cfg.devCommand, or the command
  // resolved from the project's OWN package.json (never an agent-supplied
  // command); needsCommand only when nothing is derivable. startedBy is
  // always "agent" for the MCP tool path (never caller-supplied).
  getDevServerState: (root: string) => DevServerState;
  startDevServer: (
    root: string,
    startedBy: "user" | "agent",
  ) => Promise<DevServerStartResult>;
  stopDevServer: (root: string) => DevServerState;
  // Slack connected-extension read deps (wired in server.ts, which reads the
  // vaulted token -- kept OUT of this file so the source-guard stays green).
  // slackReadChannel ENFORCES the per-project allow-list and returns { error }
  // for a channel that is not allowed / Slack not connected; it never returns a
  // token, only channel names + message text.
  slackListAllowedChannels: (
    root: string | null,
  ) => Promise<{ channels: { id: string; name: string }[] }>;
  slackReadChannel: (
    root: string | null,
    channel: string,
    limit: number,
  ) => Promise<{
    channel?: string;
    messages?: { ts: string; user: string; text: string }[];
    error?: string;
  }>;
  // GitHub read (device-flow OAuth). Reads the vaulted token main-side (kept OUT
  // of this file for the source-guard) and returns the issue's title/body/state/
  // url or an error -- never a token.
  githubReadIssue: (
    root: string | null,
    owner: string,
    repo: string,
    issue: number,
  ) => Promise<{
    title?: string;
    body?: string;
    state?: string;
    url?: string;
    error?: string;
  }>;
}

// Wrap any JSON-able result in the SDK text-content shape the ping tool uses.
function ok(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

// Return a PNG (base64) as MCP image content so the client (Claude) can see it.
function okImage(base64: string) {
  return {
    content: [{ type: "image" as const, data: base64, mimeType: "image/png" }],
  };
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

  // ONE tool for every extension, rather than one tool per product.
  //
  // This replaces docker_status / neon_status / render_services. Those three
  // were not confusable -- their names and descriptions are product-specific --
  // but the PATTERN does not scale: there are five section extensions today
  // with Snowflake and Azure graduating, and "add another _status tool per
  // product" ends in the sprawl that makes tool choice hard. Naming the
  // extension as an ARGUMENT scales; naming it in the tool does not.
  //
  // No capability is lost: with an id it returns that extension's resources
  // from the very same readers the three tools used, so Docker still reports
  // containers, Neon its projects, Render its services.
  mcp.registerTool(
    "extension_status",
    {
      description:
        "Inspect AirLock extensions (Docker, Neon, Render, Snowflake, Azure, Slack, GitHub). With no id: every extension with its connection status (connected / unauthed = not connected / absent = not installed / disabled), account label, and the actions available -- the inventory behind the Extensions hub. With an id: that extension's status PLUS its resources (Docker containers, Neon projects, Render services). Status and resource metadata only -- NO secret values, tokens or API keys. Use extension_connect to start a connect flow.",
      inputSchema: { id: z.string().optional() },
    },
    async ({ id }) => {
      const root = deps.getWorkspaceRoot();
      const rows = await deps.listExtensions(root);
      if (!id) return ok({ extensions: rows });

      const row = rows.find((r) => r.id === id);
      if (!row)
        return err(
          `Unknown extension "${id}". Call extension_status with no id to list them.`,
        );
      return ok({ ...row, resources: await extensionResources(id, root) });
    },
  );

  // Guiding a user through connecting something is the point, so this reports
  // what the HUMAN must still do and never claims to have finished the job.
  // It cannot disconnect anything (primaryConnectAction, renderer side, only
  // ever selects a connecting action), and it never handles a credential: the
  // browser approval, the pasted key and the CLI prompt all stay with the user,
  // which is where consent actually lives. A token passed as a tool argument
  // would land in the transcript.
  mcp.registerTool(
    "extension_connect",
    {
      description:
        "Start the connect flow for an extension, doing exactly what its button in the Extensions hub does: run its install/login command in a visible terminal, open its sign-in dialog, or open its own section (for Neon and Render, where an API key is pasted). Returns what was started and the step the USER must complete -- it does NOT finish the connection, and never accepts or handles a token. Cannot disconnect anything. Call extension_status first to see what needs connecting.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => drive({ type: "connect_extension", id }),
  );

  // CI for the focused project's current branch. Replaces activity_status,
  // whose other two sources (Render deploys, Docker containers) are already
  // covered by render_services and docker/database tools -- CI was the only
  // thing the Activity feed uniquely knew, so the tool narrowed with the panel.
  // Handles a null root itself: no project, no branch, no run.
  mcp.registerTool(
    "ci_status",
    {
      description:
        "Report the latest CI run for the focused project's CURRENT git branch: workflow name, status, conclusion, per-step progress, and the run URL. Returns null when there is no repo, no gh CLI, no workflow, or a detached HEAD. Status metadata only -- no secret values. The result's `root` field names which project (null = none focused) it answered for, so check it when the user may have switched tabs.",
      inputSchema: {},
    },
    async () => {
      // Echo WHICH root this answered for (QA 2026-06-11; see list_secret_names).
      const root = deps.getWorkspaceRoot();
      return ok({ root, ci: await deps.getCiRun(root) });
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
        section: z
          .string()
          .describe(
            'A sidebar section id: a built-in ("files", "git", ...) or an extension section ("ext:slack").',
          ),
        visible: z.boolean(),
      },
    },
    async ({ section, visible }) => {
      // A closed enum cannot express ext:<id> sections (they are discovered at
      // runtime), so the schema takes a string and the id is validated here --
      // a built-in or a well-formed ext:<id>, anything else a clean error.
      if (!isSectionId(section)) {
        return err(`Unknown section: ${section}`);
      }
      return ok(
        await changeVisibility(deps.prefsFile, section as Section, visible),
      );
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

  // Self-verification (opt-in): screenshot the focused window as image content so
  // Claude can see the UI. Refuses when selfVerify is off. Captures whatever is on
  // screen (including a revealed secret) -- hence the opt-in gate.
  mcp.registerTool(
    "capture_screenshot",
    {
      description:
        "Capture a PNG screenshot of AirLock's focused window (returned as an image) to visually verify the UI. Requires Self-verification enabled (Settings > Claude). Captures whatever is on screen, including any revealed secret.",
      inputSchema: {},
    },
    async () => {
      if (!(await deps.selfVerifyEnabled())) {
        return err(
          "Self-verification is disabled. Enable it in Settings > Claude.",
        );
      }
      const png = await deps.captureScreenshot();
      return png ? okImage(png) : err("No AirLock window to capture.");
    },
  );

  // Self-verification (opt-in): set an app-global pref to drive a feature. Only a
  // safe allow-list of UI/feature toggles (never security settings), enforced in
  // deps.setPref (prefWrite.applyPrefPatch).
  mcp.registerTool(
    "set_pref",
    {
      description:
        "Set an app-global AirLock preference to drive a feature (e.g. { key: 'quotaMeter', value: { enabled: true } }). Requires Self-verification enabled. Only UI/feature toggles are allowed; security settings are refused.",
      inputSchema: {
        key: z.string(),
        value: z.any(),
      },
    },
    async ({ key, value }) => {
      if (!(await deps.selfVerifyEnabled())) {
        return err(
          "Self-verification is disabled. Enable it in Settings > Claude.",
        );
      }
      const r = await deps.setPref(key, value);
      return r.ok
        ? ok({ ok: true, key })
        : err(r.error ?? "Cannot set that preference.");
    },
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
    {
      description:
        "Report the local dev server URL and reachability, plus the managed dev-server state (status/url/port/terminalId/command/startedBy/exitCode). No secret values.",
    },
    async () => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      const [host, devServer] = [
        await ide.hostStatus(root),
        deps.getDevServerState(root),
      ];
      return ok({ ...host, devServer });
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

  // Append an entry to the project's Changelog journal (.airlock/journal.jsonl),
  // shown in the Overview page. Benign + per-project -> not gated. On-demand: the
  // agent calls it when a change/decision/fix is worth recording.
  // The ONLY Changelog append. There used to be a second, single-entry
  // add_changelog_entry beside this one -- and this tool's own description had
  // to spend a sentence telling the model when to prefer it, which is a schema
  // problem wearing a description as a bandage. This one takes 1..N, so the
  // singular was strictly subsumed. Benign + per-project gating, one atomic
  // write, one UI refresh per call.
  mcp.registerTool(
    "add_changelog_entries",
    {
      description:
        "Append one or many entries to this project's Changelog (shown in the " +
        "Overview page) in a single call -- one atomic write, one UI refresh. " +
        "Use it to record a change, fix, or decision, and to backfill history. " +
        "Each entry is " +
        "{ text, tag?, details?, ts? }: `text` is the one-line title, `tag` is one of " +
        "change|fix|decision|note (default note), `details` is an optional markdown " +
        "body, and `ts` is an optional epoch-ms timestamp -- pass it to preserve a " +
        "HISTORICAL date (default: now). Entries may be given in any order; they are " +
        `stored chronologically. Max ${MAX_BULK} per call. Returns how many were ` +
        "added and how many were skipped as invalid.",
      inputSchema: {
        entries: z
          .array(
            z.object({
              text: z.string(),
              tag: z.enum(["change", "fix", "decision", "note"]).optional(),
              details: z.string().optional(),
              ts: z.number().optional(),
            }),
          )
          .min(1),
      },
    },
    async ({ entries }) => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      const r = await deps.addChangelogEntries(root, entries);
      return r.ok
        ? ok({ added: r.added, skipped: r.skipped, entries: r.entries })
        : err(r.error);
    },
  );

  // Bulk edit of NOTE entries (by ts). The git-derived Changes rows are
  // read-only, so only notes can be rewritten -- same invariant as the UI's edit.
  mcp.registerTool(
    "update_changelog_notes",
    {
      description:
        "Edit MANY Changelog NOTE entries in one call, each identified by its `ts` " +
        "(from project_info's journal): { ts, text, details? }. Only note entries can " +
        "be edited -- the git-derived Changes rows are read-only, and rows that do not " +
        `match a note are skipped. Max ${MAX_BULK} per call. Returns how many were ` +
        "updated and how many were skipped.",
      inputSchema: {
        updates: z
          .array(
            z.object({
              ts: z.number(),
              text: z.string(),
              details: z.string().optional(),
            }),
          )
          .min(1),
      },
    },
    async ({ updates }) => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      const r = await deps.updateChangelogNotes(root, updates);
      return r.ok
        ? ok({ updated: r.updated, skipped: r.skipped })
        : err(r.error);
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
        'Run a shell command with the named vaulted secrets injected into its environment; the output is returned with secret values redacted. If the command hits a risky category under the user\'s agent policy it is BLOCKED (action="ask" -> re-call with confirm:true to proceed; action="block" -> not allowed, the user must change the policy). The value is redacted from the output, but it IS present in the command\'s environment: this is a convenience so you need not handle credentials, NOT a barrier that stops a command from observing one. Do not attempt to read, encode or transmit an injected value.',
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
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      if (!terminalId) return ok(await deps.listTerminals(root));
      const res = await deps.getTerminalTail(terminalId, lines ?? 40, root);
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
      return ok(await deps.requestSecretFromUser(name, providerHint, root));
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
        'Open an IDE page-tab ("settings", "usage" or "extensions") in the focused airlock window and show it. The page-tabs sit beside the project tabs (see list_tabs\' appPages); opening an already-open page brings it back into view. Returns the resulting layout. Acts on the FOCUSED window.',
      // Keep in step with AppPage in shared/ipc.ts -- a zod enum cannot derive
      // from the type, so a new page must be added here too or the agent cannot
      // reach it (extensions was missed exactly that way).
      inputSchema: { page: z.enum(["settings", "usage", "extensions"]) },
    },
    async ({ page }) => drive({ type: "open_app_page", page }),
  );

  mcp.registerTool(
    "close_app_page",
    {
      description:
        'Close an IDE page-tab ("settings", "usage" or "extensions") in the focused airlock window. Closing a page that is not open is a no-op. Returns the resulting layout. Acts on the FOCUSED window.',
      inputSchema: { page: z.enum(["settings", "usage", "extensions"]) },
    },
    async ({ page }) => drive({ type: "close_app_page", page }),
  );

  // --- Managed dev-server tools -------------------------------------------
  // Both tools return only dev-server metadata (status/url/port/terminalId/
  // command/startedBy/exitCode) -- NEVER a secret value. start_dev_server
  // takes NO arbitrary-command argument: it runs the project's dev command --
  // the configured cfg.devCommand, or the command resolved from the project's
  // OWN package.json (never an agent-supplied command); it returns needsCommand
  // only when nothing is derivable. This matches the security invariant here.

  mcp.registerTool(
    "start_dev_server",
    {
      description:
        "Start this project's local dev server — ALWAYS use this to run, boot, or \"turn on\" the app locally. Do NOT run `npm run dev` (or the dev command) yourself in a terminal, and do NOT detach/background it to keep it alive: this tool runs the command in a SEPARATE AirLock-owned terminal that already survives across turns (it is NOT a background task the environment will SIGTERM) and that the IDE shows and manages (status, Stop/Restart). A server you start by hand is invisible and unmanaged here, and a detached one cannot be detected at all. If a dev server is ALREADY running but was not started through this tool, offer to stop it and start it here so the IDE can manage it. Starts the project's dev command — the one configured in Host, or otherwise the command resolved from the project's own package.json (e.g. `npm run dev`); returns status metadata (status/url/port) — never a secret value. It returns needsCommand ONLY when no command can be resolved (no package.json, or no dev/start script); only then, ask the user to set the dev command in the Host section (do not fall back to a raw shell command).",
    },
    async () => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      const r = await deps.startDevServer(root, "agent");
      return ok(r);
    },
  );

  mcp.registerTool(
    "stop_dev_server",
    {
      description:
        "Stop the focused project's managed dev server. Returns dev-server status. No secret values.",
    },
    async () => {
      const root = deps.getWorkspaceRoot();
      if (!root) return err(NO_WORKSPACE);
      return ok(deps.stopDevServer(root));
    },
  );

  // --- Slack connected-extension tools (allow-list gated) ------------------
  // slack_read_channel enforces the per-project allow-list in the injected dep
  // and returns { error } for a channel that is not allowed / Slack not
  // connected. Message text + channel names leave main; the token never does.
  mcp.registerTool(
    "slack_list_allowed_channels",
    {
      description:
        "List the Slack channels the user has allow-listed for THIS project -- the ONLY channels slack_read_channel can read. Returns channel names + ids (no messages, no token). Empty when Slack is not connected or nothing is allowed.",
      inputSchema: {},
    },
    async () =>
      ok(await deps.slackListAllowedChannels(deps.getWorkspaceRoot())),
  );

  mcp.registerTool(
    "slack_read_channel",
    {
      description:
        "Read recent messages from an ALLOW-LISTED Slack channel for the focused project (to pull context on a problem discussed there). `channel` is an id or name from slack_list_allowed_channels. REFUSES any channel not on the allow-list and returns { error } when Slack is not connected. Returns message text (user + ts) -- never a token.",
      inputSchema: {
        channel: z
          .string()
          .describe(
            'An allow-listed channel id or name (e.g. "bugs" or "C123").',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("How many recent messages (default 20, max 100)."),
      },
    },
    async ({ channel, limit }) =>
      ok(
        await deps.slackReadChannel(
          deps.getWorkspaceRoot(),
          channel,
          limit ?? 20,
        ),
      ),
  );

  // --- GitHub connected-extension tool (device-flow OAuth) -----------------
  // Reads an issue via the vaulted token (in the injected dep, out of this file).
  // Returns the issue text or { error } when GitHub is not connected -- no token.
  mcp.registerTool(
    "github_read_issue",
    {
      description:
        "Read a GitHub issue (title, body, state, url) for context on a problem discussed there, using the project's connected GitHub login. Args: owner, repo, issue (number). Returns { error } when GitHub is not connected. Never returns a token.",
      inputSchema: {
        owner: z.string().describe('The repo owner/org, e.g. "anthropics".'),
        repo: z.string().describe("The repository name."),
        issue: z.number().int().describe("The issue number."),
      },
    },
    async ({ owner, repo, issue }) =>
      ok(
        await deps.githubReadIssue(deps.getWorkspaceRoot(), owner, repo, issue),
      ),
  );
}
