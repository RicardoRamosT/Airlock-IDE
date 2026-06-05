// App-global preferences store. Pure read/write keyed by an explicit file
// path so the logic stays electron-free (node:fs only) and unit-testable; the
// caller (main/index.ts) supplies the userData path. ASCII comments only since
// this could in principle be bundled.
//
// AppPrefs is defined in ../shared/ipc (the single source of truth shared with
// the renderer via AirlockApi); imported here as a type so layering stays
// one-directional (main depends on shared, never the reverse).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
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
  clipboardClearSeconds: 30,
};

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
    clipboardClearSeconds:
      typeof r.clipboardClearSeconds === "number" &&
      Number.isFinite(r.clipboardClearSeconds)
        ? Math.min(3600, Math.max(0, Math.floor(r.clipboardClearSeconds)))
        : DEFAULTS.clipboardClearSeconds,
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

export async function savePrefs(
  file: string,
  patch: Partial<AppPrefs>,
): Promise<AppPrefs> {
  const next = sanitize({ ...(await loadPrefs(file)), ...patch });
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tmp, file);
  return next;
}
