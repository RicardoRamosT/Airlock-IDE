import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { buildProfile, type DetectInputs } from "@airlock/agent-core";
import type { OverviewResult } from "../../shared/ipc";
import { listSecretNames } from "../ide-state";
import { languageBreakdown } from "./languages";

const CONFIG_FILES = [
  "wrangler.toml",
  "vercel.json",
  "render.yaml",
  "netlify.toml",
  "fly.toml",
  "Dockerfile",
  "docker-compose.yml",
  "compose.yaml",
  "biome.json",
];
const MANIFESTS = [
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
];
const LOCKFILES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
];
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".airlock",
  "dist",
  "out",
  "build",
  ".next",
  "coverage",
]);

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

interface PkgLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: unknown;
}

async function readPkg(root: string): Promise<PkgLike | null> {
  try {
    return JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

// Normalize package.json `workspaces` (array or { packages: [] }) to each glob's
// leading non-glob segment, e.g. "packages/*" -> "packages". Best-effort.
function workspaceDirs(pkg: PkgLike | null): string[] | null {
  const raw = pkg?.workspaces;
  const arr = Array.isArray(raw)
    ? raw
    : raw &&
        typeof raw === "object" &&
        Array.isArray((raw as { packages?: unknown }).packages)
      ? (raw as { packages: string[] }).packages
      : null;
  if (!arr) return null;
  return arr.map((g) => g.replace(/\/?\*.*$/, "")).filter(Boolean);
}

// Dirs the file walk must never descend into (dependency/build/cache trees).
// Broader than the top-level IGNORED_DIRS above so a Python venv / Rust target
// does not dominate the language stats or stall the walk.
const WALK_IGNORE = new Set([
  ".git",
  ".airlock",
  "node_modules",
  "dist",
  "out",
  "build",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "coverage",
  "venv",
  ".venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  "target",
  "vendor",
  ".gradle",
]);
const WALK_CAP = 20000; // bound the walk so a huge tree cannot stall overviewGet

// Bounded recursive walk: collect file basenames (enough for the language
// breakdown) while skipping dependency/build/cache dirs and dot-directories.
// Best-effort -- an unreadable dir is skipped, not fatal.
async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const rec = async (dir: string): Promise<void> => {
    if (out.length >= WALK_CAP) return;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= WALK_CAP) return;
      if (e.isDirectory()) {
        if (WALK_IGNORE.has(e.name) || e.name.startsWith(".")) continue;
        await rec(path.join(dir, e.name));
      } else if (e.isFile()) {
        out.push(e.name);
      }
    }
  };
  await rec(root);
  return out;
}

const README_NAMES = ["README.md", "readme.md", "Readme.md", "README"];
const README_CAP = 64 * 1024;

// First existing README (capped). Best-effort -- null when none is present.
async function readReadme(root: string): Promise<string | null> {
  for (const name of README_NAMES) {
    try {
      const c = await readFile(path.join(root, name), "utf8");
      return c.length > README_CAP ? c.slice(0, README_CAP) : c;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

export async function gatherProfile(root: string): Promise<OverviewResult> {
  const pkg = await readPkg(root);
  const [configFiles, otherManifests, lockfiles, secretMetas, entries] =
    await Promise.all([
      Promise.all(CONFIG_FILES.map((f) => exists(path.join(root, f)))).then(
        (r) => CONFIG_FILES.filter((_, idx) => r[idx]),
      ),
      Promise.all(MANIFESTS.map((f) => exists(path.join(root, f)))).then((r) =>
        MANIFESTS.filter((_, idx) => r[idx]),
      ),
      Promise.all(LOCKFILES.map((f) => exists(path.join(root, f)))).then((r) =>
        LOCKFILES.filter((_, idx) => r[idx]),
      ),
      listSecretNames(root).catch(() => [] as { name: string }[]),
      readdir(root, { withFileTypes: true }).catch(() => []),
    ]);

  const topLevelDirs = entries
    .filter(
      (e) =>
        e.isDirectory() && !e.name.startsWith(".") && !IGNORED_DIRS.has(e.name),
    )
    .map((e) => e.name)
    .sort();

  const detectInputs: DetectInputs = {
    root,
    pkg,
    lockfiles,
    configFiles,
    otherManifests,
    secretNames: secretMetas.map((s) => s.name),
    workspaces: workspaceDirs(pkg),
    topLevelDirs,
    integrationsDetected: [], // v1
    generatedAt: Date.now(),
  };
  const profile = buildProfile(detectInputs);

  // The committed summary (hidden dir, so read it directly).
  let summary: string | null = null;
  let summaryMtimeMs = 0;
  const overviewPath = path.join(root, ".airlock", "overview.md");
  try {
    summary = await readFile(overviewPath, "utf8");
    summaryMtimeMs = (await stat(overviewPath)).mtimeMs;
  } catch {
    /* no summary yet */
  }

  // Richer-content extras: a bounded file walk for language stats + the README.
  // Run concurrently; both are best-effort and never throw.
  const [names, readme] = await Promise.all([walkFiles(root), readReadme(root)]);
  const stats = {
    fileCount: names.length,
    languages: languageBreakdown(names),
  };
  return { profile, summary, summaryMtimeMs, stats, readme };
}
