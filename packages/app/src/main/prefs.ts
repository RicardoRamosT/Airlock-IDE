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
  "databases",
  "docker",
  "host",
  "audit",
];

const DEFAULT_SECTION_VISIBILITY: SectionVisibility = {
  files: true,
  secrets: true,
  git: true,
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

function sanitize(raw: unknown): AppPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };
  const r = raw as Record<string, unknown>;
  return {
    sidebarVisible:
      typeof r.sidebarVisible === "boolean"
        ? r.sidebarVisible
        : DEFAULTS.sidebarVisible,
    sidebarPosition: r.sidebarPosition === "right" ? "right" : "left",
    theme: r.theme === "light" ? "light" : "dark",
    sectionVisibility: sanitizeSectionVisibility(r.sectionVisibility),
  };
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
