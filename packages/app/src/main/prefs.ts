// App-global preferences store. Pure read/write keyed by an explicit file
// path so the logic stays electron-free (node:fs only) and unit-testable; the
// caller (main/index.ts) supplies the userData path. ASCII comments only since
// this could in principle be bundled.
//
// AppPrefs is defined in ../shared/ipc (the single source of truth shared with
// the renderer via AirlockApi); imported here as a type so layering stays
// one-directional (main depends on shared, never the reverse).
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type AgentCommandPolicy,
  DEFAULT_AGENT_POLICY,
  KNOWN_TERMINALS,
  type Level,
} from "@airlock/agent-core";
import {
  type AppPrefs,
  ATLAS_STANDING_DEFAULT,
  ATLAS_STANDING_MAX,
  ATLAS_STANDING_MIN,
  type BuiltinSection,
  type ClaudeAutoStart,
  type Section,
  type SectionVisibility,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from "../shared/ipc";

export const BUILTIN_SECTIONS: BuiltinSection[] = [
  "files",
  "secrets",
  "git",
  "databases",
  "host",
  "audit",
  "events",
  // Last, matching the rail: the Extensions hub leads the extensions group,
  // below the divider, so the View menu lists it in the same place.
  "extensions",
];

// A valid sidebar section id: a known built-in, or a well-formed ext:<id>.
// Shared by the sections:set IPC and the MCP visibility tool so both accept
// extension sections and reject junk identically.
export function isSectionId(id: string): boolean {
  return (BUILTIN_SECTIONS as string[]).includes(id) || /^ext:[^:]+$/.test(id);
}

const DEFAULT_SECTION_VISIBILITY: SectionVisibility = {
  files: true,
  secrets: true,
  git: true,
  databases: true,
  host: true,
  extensions: true,
  audit: true,
  events: true,
};

const DEFAULTS: AppPrefs = {
  sidebarVisible: true,
  sidebarPosition: "left",
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  theme: "dark",
  sectionVisibility: { ...DEFAULT_SECTION_VISIBILITY },
  activeView: "files",
  clipboardClearSeconds: 30,
  editorFontSize: 13,
  openProjectsAsTabs: true,
  showRunningProcessNotice: true,
  askBeforeTerminalInput: false,
  recentFolders: [],
  agentPolicy: { ...DEFAULT_AGENT_POLICY },
  quotaMeter: { enabled: true },
  atlas: {
    enabled: true,
    acknowledged: false,
    surface: "app",
    hour: 9,
    width: 380,
    height: 460,
    standingHeight: ATLAS_STANDING_DEFAULT,
    lastReadDay: "",
    lastView: "brief",
  },
  dockStatus: { enabled: true },
  runAppSkill: { enabled: true },
  selfVerify: { enabled: false },
  eventLog: { enabled: true, minLevel: "debug" as Level },
  claudeAutoStart: "first",
  claudeSkipPermissions: false,
  githubAutoSwitch: true,
  defaultTerminal: "airlock",
  restoreSession: true,
};

const CLAUDE_AUTO_MODES: ClaudeAutoStart[] = ["off", "first", "every"];

// Most-recent-first list of opened folder paths. Drop non-strings and empty
// strings, dedupe (keeping the first/most-recent occurrence), and cap the
// length. Always returns a fresh array so DEFAULTS.recentFolders is not shared.
export const RECENT_CAP = 10;
function sanitizeRecentFolders(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === "string" && v.length > 0 && !seen.has(v)) {
      seen.add(v);
      out.push(v);
      if (out.length >= RECENT_CAP) break;
    }
  }
  return out;
}

// Drop one folder from the recents list.
//
// The list only ever grew a promotion path (recordAndOpen puts the opened
// folder first); nothing removed an entry. That is what made a deleted project
// permanent: Atlas seeds its registry from recents, so a root deleted from the
// registry was re-seeded on the next refresh and its "folder is gone from
// disk" concern re-raised, twice over. Returns a fresh array; a root that is
// not there is not an error.
export function withoutRecentFolder(
  recents: readonly string[],
  root: string,
): string[] {
  return recents.filter((p) => p !== root);
}

// Allowlist per key: only a real boolean overrides the default; unknown keys
// (and a non-object) are dropped. Always returns a COMPLETE map.
function sanitizeSectionVisibility(raw: unknown): SectionVisibility {
  const out: SectionVisibility = { ...DEFAULT_SECTION_VISIBILITY };
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const [key, value] of Object.entries(r)) {
      if (typeof value !== "boolean") continue;
      // Built-ins are known; ext:* keys are passed through so an extension's
      // hide/show choice survives a restart. Everything else is dropped.
      if (
        (BUILTIN_SECTIONS as string[]).includes(key) ||
        key.startsWith("ext:")
      ) {
        out[key] = value;
      }
    }
  }
  return out;
}

// Validates each category's action is one of allow/ask/block, falling back to
// the default per key. Exported so ipc.ts can import it for the agentPolicy:set
// handler.
export function sanitizeAgentPolicy(value: unknown): AgentCommandPolicy {
  const v = (value ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_AGENT_POLICY };
  for (const k of Object.keys(
    DEFAULT_AGENT_POLICY,
  ) as (keyof AgentCommandPolicy)[]) {
    const a = v[k];
    if (a === "allow" || a === "ask" || a === "block") out[k] = a;
  }
  return out;
}

// installSalt: a 32-hex random string generated once and persisted so token
// derivation is stable across launches. OPTIONAL: absent until first needed.
// Only a valid 32-hex string is passed through; anything else is dropped so
// the caller re-generates and persists it.
function sanitizeInstallSalt(raw: unknown): string | undefined {
  return typeof raw === "string" && /^[0-9a-f]{32}$/.test(raw)
    ? raw
    : undefined;
}

// Pass the MCP identity through only when fully well-formed: port a finite
// number and token a non-empty string. Anything else (absent, partial, wrong
// types) returns undefined so the field is dropped and ensureMcpConfig will
// regenerate it. mcp is OPTIONAL, so default prefs deliberately omit it.
function sanitizeMcp(
  raw: unknown,
): { port: number; token: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.port === "number" &&
    Number.isFinite(r.port) &&
    typeof r.token === "string" &&
    r.token.length > 0
  ) {
    return { port: r.port, token: r.token };
  }
  return undefined;
}

// quotaMeter is app-global and ON by default. A real boolean `enabled` (incl.
// explicit false to turn it off) is honored; anything else (absent, partial,
// wrong type) -> enabled.
function sanitizeQuotaMeter(raw: unknown): { enabled: boolean } {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (typeof r.enabled === "boolean") return { enabled: r.enabled };
  }
  return { enabled: true };
}

// atlas is app-global. `enabled` defaults ON, but `acknowledged` defaults OFF
// and must be set deliberately: until it is true, Atlas spends nothing. A
// corrupt or partial value must therefore fall back to NOT acknowledged --
// failing open here would spend an API-key user's money without asking.
function sanitizeAtlas(raw: unknown): AppPrefs["atlas"] {
  let enabled = true;
  let acknowledged = false;
  // In-app is the default surface: the menu bar item is opt-in.
  let surface: "app" | "both" = "app";
  let hour = 9;
  let width = 380;
  let height = 460;
  let standingHeight = ATLAS_STANDING_DEFAULT;
  let lastReadDay = "";
  // Opening on the debrief is the right FIRST-run default; after that the
  // panel reopens wherever the user last was.
  let lastView: "brief" | "chat" = "brief";
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (typeof r.enabled === "boolean") enabled = r.enabled;
    if (r.acknowledged === true) acknowledged = true;
    if (r.surface === "both" || r.surface === "app") surface = r.surface;
    if (r.lastView === "chat" || r.lastView === "brief") lastView = r.lastView;
    if (
      typeof r.hour === "number" &&
      Number.isInteger(r.hour) &&
      r.hour >= 0 &&
      r.hour <= 23
    ) {
      hour = r.hour;
    }
    // Clamped: a hand-edited prefs file must not produce a 4px or 9000px panel.
    if (typeof r.width === "number" && Number.isFinite(r.width)) {
      width = Math.min(900, Math.max(280, Math.round(r.width)));
    }
    if (typeof r.height === "number" && Number.isFinite(r.height)) {
      height = Math.min(1200, Math.max(240, Math.round(r.height)));
    }
    // Clamped to the SAME interval the drag handle commits, so no prefs file
    // can carry a height no gesture could produce.
    if (
      typeof r.standingHeight === "number" &&
      Number.isFinite(r.standingHeight)
    ) {
      standingHeight = Math.min(
        ATLAS_STANDING_MAX,
        Math.max(ATLAS_STANDING_MIN, Math.round(r.standingHeight)),
      );
    }
    if (typeof r.lastReadDay === "string") lastReadDay = r.lastReadDay;
  }
  return {
    enabled,
    acknowledged,
    surface,
    hour,
    width,
    height,
    standingHeight,
    lastReadDay,
    lastView,
  };
}

// dockStatus is app-global and ON by default (opt-out). Enabling reconciles the
// Claude Code hooks in ~/.claude/settings.json; disabling removes them. A real
// boolean `enabled` (incl. explicit false to turn it off) is honored; anything
// else (absent, partial, wrong type) -> enabled.
function sanitizeDockStatus(raw: unknown): { enabled: boolean } {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (typeof r.enabled === "boolean") return { enabled: r.enabled };
  }
  return { enabled: true };
}

// runAppSkill is app-global and ON by default. A real boolean `enabled` (incl.
// explicit false to turn it off) is honored; anything else (absent, partial,
// wrong type) -> enabled.
// githubAutoSwitch is app-global and ON by default. A real boolean (incl.
// explicit false) is honored; anything else (absent, wrong type) -> true.
function sanitizeGithubAutoSwitch(raw: unknown): boolean {
  return typeof raw === "boolean" ? raw : true;
}

function sanitizeRunAppSkill(raw: unknown): { enabled: boolean } {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (typeof r.enabled === "boolean") return { enabled: r.enabled };
  }
  return { enabled: true };
}

// selfVerify is app-global and OFF by default (opt-in: enabling installs the
// airlock-verify skill + arms the capture_screenshot/set_pref MCP tools). Only a
// real boolean is honored; anything else (absent, partial, wrong type) -> off.
function sanitizeSelfVerify(raw: unknown): { enabled: boolean } {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (typeof r.enabled === "boolean") return { enabled: r.enabled };
  }
  return { enabled: false };
}

const EVENT_LEVELS: readonly Level[] = ["debug", "info", "warn", "error"];
function sanitizeEventLog(raw: unknown): { enabled: boolean; minLevel: Level } {
  const def = { enabled: true, minLevel: "debug" as Level };
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    const enabled = typeof r.enabled === "boolean" ? r.enabled : def.enabled;
    const minLevel =
      typeof r.minLevel === "string" &&
      EVENT_LEVELS.includes(r.minLevel as Level)
        ? (r.minLevel as Level)
        : def.minLevel;
    return { enabled, minLevel };
  }
  return def;
}

const TERMINAL_IDS = new Set(["airlock", ...KNOWN_TERMINALS.map((t) => t.id)]);

// defaultTerminal must be "airlock" or a known terminal id; anything else
// (a deleted app, garbage) coerces to "airlock" so the user is never left
// with no way to open a terminal.
export function sanitizeDefaultTerminal(raw: unknown): string {
  return typeof raw === "string" && TERMINAL_IDS.has(raw) ? raw : "airlock";
}

// Extension Hub per-integration prefs. Keep every string key whose value is an
// object, passing through only real boolean `enabled`/`pinned`. Returns
// undefined when nothing valid remains so default prefs omit the key (matching
// the optional `mcp`/`installSalt` attach pattern -> toEqual(DEFAULTS) stays
// exact).
function sanitizeExtensions(
  raw: unknown,
): Record<string, { enabled?: boolean; pinned?: boolean }> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, { enabled?: boolean; pinned?: boolean }> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const e: { enabled?: boolean; pinned?: boolean } = {};
    if (typeof r.enabled === "boolean") e.enabled = r.enabled;
    if (typeof r.pinned === "boolean") e.pinned = r.pinned;
    out[k] = e;
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitize(raw: unknown): AppPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };
  const r = raw as Record<string, unknown>;
  const out: AppPrefs = {
    sidebarVisible:
      typeof r.sidebarVisible === "boolean"
        ? r.sidebarVisible
        : DEFAULTS.sidebarVisible,
    sidebarPosition: r.sidebarPosition === "right" ? "right" : "left",
    sidebarWidth:
      typeof r.sidebarWidth === "number" && Number.isFinite(r.sidebarWidth)
        ? Math.min(
            SIDEBAR_WIDTH_MAX,
            Math.max(SIDEBAR_WIDTH_MIN, Math.round(r.sidebarWidth)),
          )
        : DEFAULTS.sidebarWidth,
    theme: r.theme === "light" ? "light" : "dark",
    sectionVisibility: sanitizeSectionVisibility(r.sectionVisibility),
    activeView:
      typeof r.activeView === "string" &&
      ((BUILTIN_SECTIONS as string[]).includes(r.activeView) ||
        r.activeView.startsWith("ext:"))
        ? (r.activeView as Section)
        : "files",
    clipboardClearSeconds:
      typeof r.clipboardClearSeconds === "number" &&
      Number.isFinite(r.clipboardClearSeconds)
        ? Math.min(3600, Math.max(0, Math.floor(r.clipboardClearSeconds)))
        : DEFAULTS.clipboardClearSeconds,
    editorFontSize:
      typeof r.editorFontSize === "number" && Number.isFinite(r.editorFontSize)
        ? Math.min(40, Math.max(8, Math.floor(r.editorFontSize)))
        : DEFAULTS.editorFontSize,
    openProjectsAsTabs:
      typeof r.openProjectsAsTabs === "boolean"
        ? r.openProjectsAsTabs
        : DEFAULTS.openProjectsAsTabs,
    showRunningProcessNotice:
      typeof r.showRunningProcessNotice === "boolean"
        ? r.showRunningProcessNotice
        : DEFAULTS.showRunningProcessNotice,
    askBeforeTerminalInput: r.askBeforeTerminalInput === true,
    recentFolders: sanitizeRecentFolders(r.recentFolders),
    agentPolicy: sanitizeAgentPolicy(r.agentPolicy),
    quotaMeter: sanitizeQuotaMeter(r.quotaMeter),
    atlas: sanitizeAtlas(r.atlas),
    dockStatus: sanitizeDockStatus(r.dockStatus),
    githubAutoSwitch: sanitizeGithubAutoSwitch(r.githubAutoSwitch),
    runAppSkill: sanitizeRunAppSkill(r.runAppSkill),
    selfVerify: sanitizeSelfVerify(r.selfVerify),
    eventLog: sanitizeEventLog(r.eventLog),
    // Off unless explicitly true: a partial or hand-edited prefs file must not
    // silently turn permission prompts off.
    claudeSkipPermissions: r.claudeSkipPermissions === true,
    claudeAutoStart: CLAUDE_AUTO_MODES.includes(
      r.claudeAutoStart as ClaudeAutoStart,
    )
      ? (r.claudeAutoStart as ClaudeAutoStart)
      : "first",
    defaultTerminal: sanitizeDefaultTerminal(r.defaultTerminal),
    restoreSession:
      typeof r.restoreSession === "boolean"
        ? r.restoreSession
        : DEFAULTS.restoreSession,
  };
  // Only attach mcp when present and valid; keep it off the object otherwise so
  // toEqual against the defaults (which have no mcp key) stays exact.
  const mcp = sanitizeMcp(r.mcp);
  if (mcp) out.mcp = mcp;
  // Only attach installSalt when a valid 32-hex string; absent until generated.
  const installSalt = sanitizeInstallSalt(r.installSalt);
  if (installSalt) out.installSalt = installSalt;
  // Only attach extensions when at least one valid entry survives.
  const extensions = sanitizeExtensions(r.extensions);
  if (extensions) out.extensions = extensions;
  return out;
}

// Strip main-only fields before the renderer sees a prefs value.
// installSalt is an HMAC salt for per-project MCP token derivation; the
// renderer never needs it. mcp.token is intentionally preserved (pre-existing
// behavior; the renderer uses it to connect to the local MCP server).
export function publicPrefs(p: AppPrefs): AppPrefs {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { installSalt: _salt, ...rest } = p as AppPrefs & {
    installSalt?: unknown;
  };
  return rest as AppPrefs;
}

// The three outcomes a prefs read can have, kept distinct because savePrefs
// MERGES ITS PATCH ONTO THIS AND WRITES IT BACK. Collapsing them is how a
// single unreadable prefs.json silently reset every preference the user had:
// recentFolders and the window size are saved constantly, so the reset landed
// within seconds and took installSalt and the MCP token with it.
export class PrefsUnreadableError extends Error {}

async function readPrefsBaseline(
  file: string,
): Promise<{ prefs: AppPrefs; corruptText?: string }> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { prefs: { ...DEFAULTS } }; // absent -> defaults (normal first run)
    }
    // Present but unreadable (EACCES, EISDIR, EIO). The bytes cannot even be
    // preserved, so refusing is the only move that does not destroy them.
    throw new PrefsUnreadableError(
      `${file} exists but could not be read: ${(e as Error).message}`,
    );
  }
  try {
    return { prefs: sanitize(JSON.parse(text)) };
  } catch {
    // Malformed IS recoverable -- the bytes are in hand. Warn, fall back to
    // defaults for reading, and hand the original text to the writer so it can
    // be preserved beside the file (the same contract .airlock/config.json has).
    console.warn("[airlock] prefs.json malformed, using defaults");
    return { prefs: { ...DEFAULTS }, corruptText: text };
  }
}

// Readers degrade to defaults on ANY failure -- a broken prefs file must never
// stop the app from starting. Only the WRITE path is strict.
export async function loadPrefs(file: string): Promise<AppPrefs> {
  try {
    return (await readPrefsBaseline(file)).prefs;
  } catch {
    return { ...DEFAULTS };
  }
}

// Serialize writes per file. savePrefs is a read-modify-write (load -> merge ->
// write); two concurrent calls both read the same baseline and the last rename
// wins, dropping the other's patch. Chain through a per-file promise queue so the
// load happens only after the prior write's rename completes -> no lost update.
// (audit PB-H13)
const prefsWriteQueues = new Map<string, Promise<unknown>>();

export function savePrefs(
  file: string,
  patch: Partial<AppPrefs>,
): Promise<AppPrefs> {
  const prev = prefsWriteQueues.get(file) ?? Promise.resolve();
  const run = prev.then(
    () => savePrefsNow(file, patch),
    () => savePrefsNow(file, patch),
  );
  // Store a non-rejecting tail so a failed save can't wedge the queue.
  prefsWriteQueues.set(
    file,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function savePrefsNow(
  file: string,
  patch: Partial<AppPrefs>,
): Promise<AppPrefs> {
  // Strict on purpose: this is a read-modify-write, so an unreadable baseline
  // throws rather than silently becoming DEFAULTS + patch.
  const { prefs, corruptText } = await readPrefsBaseline(file);
  if (corruptText !== undefined) {
    // Keep the user's original bytes before overwriting them with defaults.
    // Best-effort: failing to save the copy must not block the write, or an
    // unwritable directory would wedge every preference change.
    await writeFile(`${file}.corrupt`, corruptText, {
      encoding: "utf8",
      mode: 0o600,
    }).catch(() => {});
  }
  const next = sanitize({ ...prefs, ...patch });
  await mkdir(path.dirname(file), { recursive: true });
  // Unique tmp per write so two serialized (or stray concurrent) writers never
  // share one temp file. (audit PB-H13)
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tmp, file);
  return next;
}
