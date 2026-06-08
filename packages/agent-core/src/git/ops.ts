import { runGit } from "./run";

function assertPaths(paths: string[]): void {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("paths must be a non-empty array");
  }
  for (const p of paths) {
    if (typeof p !== "string" || p.length === 0)
      throw new Error("paths must be strings");
  }
}

const BRANCH_NAME = /^[A-Za-z0-9._/-]+$/;

function assertBranchName(name: string): void {
  if (!BRANCH_NAME.test(name) || name.startsWith("-") || name.includes("..")) {
    throw new Error(`Invalid branch name: ${name}`);
  }
}

export async function stageFiles(root: string, paths: string[]): Promise<void> {
  assertPaths(paths);
  await runGit(root, ["add", "--", ...paths]);
}

export async function unstageFiles(
  root: string,
  paths: string[],
): Promise<void> {
  assertPaths(paths);
  try {
    await runGit(root, ["restore", "--staged", "--", ...paths]);
  } catch (err) {
    // Unborn branch (no commits yet): restore cannot resolve HEAD; rm --cached
    // is the unborn-safe unstage. Any other failure propagates untouched.
    if (err instanceof Error && /HEAD/.test(err.message)) {
      await runGit(root, ["rm", "--cached", "--", ...paths]);
    } else {
      throw err;
    }
  }
}

export async function commitStaged(
  root: string,
  message: string,
): Promise<string> {
  if (typeof message !== "string" || message.trim().length === 0) {
    throw new Error("Commit message must not be empty");
  }
  await runGit(root, ["commit", "-m", message]);
  return (await runGit(root, ["rev-parse", "--short", "HEAD"])).trim();
}

export async function listBranches(root: string): Promise<string[]> {
  const out = await runGit(root, ["branch", "--format=%(refname:short)"]);
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export async function switchBranch(root: string, name: string): Promise<void> {
  assertBranchName(name);
  await runGit(root, ["switch", name]);
}

export async function createBranch(root: string, name: string): Promise<void> {
  assertBranchName(name);
  await runGit(root, ["switch", "-c", name]);
}

// Origin remote URL (null when no origin/remote -> caller falls back to all
// services).
export async function originRemoteUrl(root: string): Promise<string | null> {
  try {
    return (await runGit(root, ["remote", "get-url", "origin"])).trim() || null;
  } catch {
    return null;
  }
}

// Full SHA of a ref (default HEAD) for the deploy-vs-local compare.
export async function headSha(root: string, ref = "HEAD"): Promise<string> {
  return (await runGit(root, ["rev-parse", ref])).trim();
}

// Remote sync. All shell out to git, so the user's configured credential helper /
// SSH keys apply (like the terminal). pull is --ff-only: a diverged branch fails
// cleanly with a message instead of opening a merge-message editor in our no-TTY
// child process (which would hang). push auto-publishes when there is no upstream.
export async function gitFetch(root: string): Promise<void> {
  await runGit(root, ["fetch"]);
}

export async function gitPull(root: string): Promise<void> {
  await runGit(root, ["pull", "--ff-only"]);
}

export async function gitPush(root: string): Promise<void> {
  let hasUpstream = true;
  try {
    await runGit(root, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    ]);
  } catch {
    hasUpstream = false;
  }
  if (hasUpstream) {
    await runGit(root, ["push"]);
    return;
  }
  const branch = (
    await runGit(root, ["symbolic-ref", "--short", "HEAD"])
  ).trim();
  await runGit(root, ["push", "-u", "origin", branch]);
}
