// Compose the staged-secret scan with the commit. Advisory (human IPC): commit
// regardless, return the leaks. Gated (agent git_commit tool): hold back a
// suspected-leak commit until confirm:true. ASCII-only.
import { commitStaged } from "@airlock/agent-core";
import type { CommitOutcome } from "../../shared/ipc";
import { scanStaged } from "./scan";

export async function guardedCommit(
  root: string,
  message: string,
  opts: { gated: boolean; confirm?: boolean },
): Promise<CommitOutcome> {
  const leaks = await scanStaged(root);
  if (opts.gated && leaks.length > 0 && !opts.confirm) {
    return { committed: false, sha: null, blocked: true, leaks };
  }
  const sha = await commitStaged(root, message);
  return { committed: true, sha, leaks };
}
