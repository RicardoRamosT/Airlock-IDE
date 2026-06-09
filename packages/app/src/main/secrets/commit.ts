// Compose the staged-secret scan with the commit. Advisory (human IPC): commit
// regardless, return the leaks. Gated (agent git_commit tool): hold back a
// suspected-leak commit until confirm:true. ASCII-only.
import { appendAudit, commitStaged } from "@airlock/agent-core";
import type { CommitOutcome } from "../../shared/ipc";
import { scanStaged } from "./scan";

export async function guardedCommit(
  root: string,
  message: string,
  opts: { gated: boolean; confirm?: boolean },
): Promise<CommitOutcome> {
  // The single commit path for BOTH the human (gated:false) and the agent
  // (gated:true). Audit every outcome so the tamper-evident chain covers commits
  // the way it covers command.run -- in particular a leak-gated agent commit held
  // back, and a commit that proceeded DESPITE detected leaks (leaks > 0 in the
  // entry flags it). actor distinguishes the human IPC from the agent tool.
  const actor: "user" | "agent" = opts.gated ? "agent" : "user";
  const leaks = await scanStaged(root);
  if (opts.gated && leaks.length > 0 && !opts.confirm) {
    await appendAudit(root, actor, "git.commit.blocked", {
      leaks: leaks.length,
    });
    return { committed: false, sha: null, blocked: true, leaks };
  }
  const sha = await commitStaged(root, message);
  await appendAudit(root, actor, "git.commit", { sha, leaks: leaks.length });
  return { committed: true, sha, leaks };
}
