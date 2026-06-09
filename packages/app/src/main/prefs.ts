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
} from "@airlock/agent-core";
import type { AppPrefs, Section, SectionVisibility } from "../shared/ipc";

export const SECTIONS: Section[] = [
  "files",
  "secrets",
  "git",
  "activity",
  "databases",
  "docker",
  "host",
  "audit",
];

const DEFAULT_SECTION_VISIBILITY: SectionVisibility = {
  files: true,
  secrets: true,
  git: true,
  activity: true,
  databases: true,
  docker: true,
  host: true,
  audit: true,
};

const DEFAULTS: AppPrefs = {
  sidebarVisible: true,
  sidebarPosition: "left",
  theme: "dark",
  sectionVisibility: { ...DEFAULT_SECTION_VISIBILITY },
  activeView: "files",
  clipboardClearSeconds: 30,
  openProjectsAsTabs: true,
  showRunningProcessNotice: true,
  recentFolders: [],
  agentPolicy: { ...DEFAULT_AGENT_POLICY },
  quotaMeter: { enabled: true },
};

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

// Allowlist per key: only a real boolean overrides the default; unknown keys
// (and a non-object) are dropped. Always returns a COMPLETE map.
function sanitizeSectionVisibility(raw: unknown): SectionVisibility {
  const out: SectionVisibility = { ...DEFAULT_SECTION_VISIBILITY };
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const key of SECTIONS) {
      if (typeof r[key] === "boolean") out[key] = r[key] as boolean;
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

function sanitize(raw: unknown): AppPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };
  const r = raw as Record<string, unknown>;
  const out: AppPrefs = {
    sidebarVisible:
      typeof r.sidebarVisible === "boolean"
        ? r.sidebarVisible
        : DEFAULTS.sidebarVisible,
    sidebarPosition: r.sidebarPosition === "right" ? "right" : "left",
    theme: r.theme === "light" ? "light" : "dark",
    sectionVisibility: sanitizeSectionVisibility(r.sectionVisibility),
    activeView: SECTIONS.includes(r.activeView as Section)
      ? (r.activeView as Section)
      : "files",
    clipboardClearSeconds:
      typeof r.clipboardClearSeconds === "number" &&
      Number.isFinite(r.clipboardClearSeconds)
        ? Math.min(3600, Math.max(0, Math.floor(r.clipboardClearSeconds)))
        : DEFAULTS.clipboardClearSeconds,
    openProjectsAsTabs:
      typeof r.openProjectsAsTabs === "boolean"
        ? r.openProjectsAsTabs
        : DEFAULTS.openProjectsAsTabs,
    showRunningProcessNotice:
      typeof r.showRunningProcessNotice === "boolean"
        ? r.showRunningProcessNotice
        : DEFAULTS.showRunningProcessNotice,
    recentFolders: sanitizeRecentFolders(r.recentFolders),
    agentPolicy: sanitizeAgentPolicy(r.agentPolicy),
    quotaMeter: sanitizeQuotaMeter(r.quotaMeter),
  };
  // Only attach mcp when present and valid; keep it off the object otherwise so
  // toEqual against the defaults (which have no mcp key) stays exact.
  const mcp = sanitizeMcp(r.mcp);
  if (mcp) out.mcp = mcp;
  return out;
}

export async function loadPrefs(file: string): Promise<AppPrefs> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return { ...DEFAULTS }; // absent -> defaults (normal first run)
  }
  try {
    return sanitize(JSON.parse(text));
  } catch {
    // Malformed prefs must never break startup; warn and use defaults.
    console.warn("[airlock] prefs.json malformed, using defaults");
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
  const next = sanitize({ ...(await loadPrefs(file)), ...patch });
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
