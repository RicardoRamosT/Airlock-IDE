import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { buildProfile, type DetectInputs } from "@airlock/agent-core";
import type { OverviewResult } from "../../shared/ipc";
import { listSecretNames } from "../ide-state";

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
  return { profile, summary, summaryMtimeMs };
}
