// The latest CI run for a project's CURRENT branch.
//
// One implementation, two callers: the git:ciRun IPC (the Git section's CI row)
// and the ci_status MCP tool. A second copy is how the agent's view of CI and
// the user's drift apart -- the same argument that put extensionActions in
// agent-core.
//
// Every failure mode degrades to null: not a repo, no `gh` on PATH, no
// workflows, a detached HEAD, or a gh call that fails. "No CI to report" is a
// normal state here, not an error -- which is why the Git section simply omits
// the row rather than showing a broken one.
import { type CiRun, gitStatus, latestCiRun } from "@airlock/agent-core";
import { ghRunnerFor } from "./ghRunner";

/**
 * `known` is a branch the caller already read, so this does not spawn its own
 * `git status` for it. The spine polls on a timer and had just computed the
 * branch a moment earlier -- one redundant process per project per cycle,
 * which stops being invisible once the poll covers a whole portfolio. Every
 * other caller passes nothing and gets the original behaviour.
 */
export async function ciRunFor(
  root: string | null,
  known?: string | null,
): Promise<{ branch: string; run: CiRun } | null> {
  if (!root) return null;
  try {
    const branch = known ?? (await gitStatus(root)).branch.head;
    // A detached HEAD has no branch to ask GitHub about.
    if (!branch || branch === "(detached)") return null;
    // As THIS PROJECT's pinned account. gh has one globally active account, so
    // a pinned repo asked by the active one 404s -- and that 404 lands in the
    // catch below as "no CI to report", which is indistinguishable from green.
    const gh = await ghRunnerFor(root);
    const run = await latestCiRun(branch, root, gh.run);
    return run ? { branch, run } : null;
  } catch {
    return null;
  }
}
