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

export async function ciRunFor(
  root: string | null,
): Promise<{ branch: string; run: CiRun } | null> {
  if (!root) return null;
  try {
    const branch = (await gitStatus(root)).branch.head;
    // A detached HEAD has no branch to ask GitHub about.
    if (!branch || branch === "(detached)") return null;
    const run = await latestCiRun(branch, root);
    return run ? { branch, run } : null;
  } catch {
    return null;
  }
}
