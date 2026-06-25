import { runGitAuthed } from "./auth";
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

// Mirror git check-ref-format's main rules (the char class already excludes
// space and ~^:?*[\ @). Reject the cases the old check missed: a leading dot, a
// trailing dot/slash, a ".lock" suffix, and a "/." component (audit L3) -- git
// rejects all of these, so catching them here fails early with a clear message
// instead of an opaque git error (and avoids a surprising ref like ".x"/"x.lock").
function assertBranchName(name: string): void {
  if (
    !BRANCH_NAME.test(name) ||
    name.startsWith("-") ||
    name.startsWith(".") ||
    name.endsWith(".") ||
    name.endsWith("/") ||
    name.endsWith(".lock") ||
    name.includes("..") ||
    name.includes("//") ||
    name.includes("/.")
  ) {
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

// Discard local changes. Tracked paths are restored to HEAD (both the index and
// the working tree); untracked paths are removed from disk. DESTRUCTIVE -- the
// modifications / new files are gone. The caller groups rows by status and sets
// `untracked` accordingly (an untracked path has no HEAD version to restore).
export async function discardChanges(
  root: string,
  paths: string[],
  untracked: boolean,
): Promise<void> {
  assertPaths(paths);
  if (untracked) {
    await runGit(root, ["clean", "-fd", "--", ...paths]);
  } else {
    await runGit(root, ["restore", "--staged", "--worktree", "--", ...paths]);
  }
}

// Undo the most recent commit, keeping its changes STAGED (a soft reset). The
// commit leaves the branch but nothing in the working tree is lost, so you can
// re-commit (fix the message, add a file, ...). Throws when there is no prior
// commit. The caller warns when the commit was already pushed, since
// uncommitting a pushed commit diverges from the remote.
export async function undoLastCommit(root: string): Promise<void> {
  await runGit(root, ["reset", "--soft", "HEAD~1"]);
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

// Remote sync. Network ops go through runGitAuthed: with a token (per-project
// account) it injects that account's credentials for this one call; with null
// it falls back to the user's configured credential helper / SSH keys (today's
// behavior). The local rev-parse/symbolic-ref need no network, so they stay on
// plain runGit. pull is --ff-only: a diverged branch fails cleanly instead of
// opening a merge-message editor in our no-TTY child (which would hang). push
// auto-publishes when there is no upstream.
export async function gitFetch(
  root: string,
  token: string | null = null,
): Promise<void> {
  await runGitAuthed(root, token, ["fetch"]);
}

export async function gitPull(
  root: string,
  token: string | null = null,
): Promise<void> {
  await runGitAuthed(root, token, ["pull", "--ff-only"]);
}

export async function gitPush(
  root: string,
  token: string | null = null,
): Promise<void> {
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
    await runGitAuthed(root, token, ["push"]);
    return;
  }
  // No upstream: publish the current branch. In DETACHED HEAD there is no
  // branch, so symbolic-ref throws a raw "ref HEAD is not a symbolic ref" fatal;
  // translate it into a clear, actionable message. (audit L2)
  let branch: string;
  try {
    branch = (await runGit(root, ["symbolic-ref", "--short", "HEAD"])).trim();
  } catch {
    throw new Error(
      "Cannot push: HEAD is detached (not on a branch). Switch to or create a branch first.",
    );
  }
  await runGitAuthed(root, token, ["push", "-u", "origin", branch]);
}
