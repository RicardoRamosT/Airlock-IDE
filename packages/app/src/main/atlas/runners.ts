// ASCII comments only. The only place Atlas touches the real filesystem and
// git. Thin by design and untested per the project convention -- every rule
// worth testing lives in agent-core behind CollectDeps.
//
// Collection is READ-ONLY. Nothing here runs `gh auth switch`, writes git
// config, or changes any global single-valued resource (spec section 11).

import { access } from "node:fs/promises";
import {
  COMMIT_LOG_FORMAT,
  type CollectDeps,
  gitStatus,
  isGitRepo,
  parseCommitLog,
  runGit,
} from "@airlock/agent-core";

export function makeCollectDeps(): CollectDeps {
  return {
    async exists(root) {
      try {
        await access(root);
        return true;
      } catch {
        return false;
      }
    },
    isRepo: (root) => isGitRepo(root),
    // gitStatus already runs and parses porcelain v2 WITH --untracked-files=all,
    // so the dirty count includes files inside an untracked directory rather
    // than counting the directory as a single entry. Do not re-roll this.
    status: (root) => gitStatus(root),
    async log(root, sinceMs) {
      const since = new Date(sinceMs).toISOString();
      const raw = await runGit(root, [
        "log",
        "--all",
        `--since=${since}`,
        `--format=${COMMIT_LOG_FORMAT}`,
      ]);
      return parseCommitLog(raw);
    },
  };
}
