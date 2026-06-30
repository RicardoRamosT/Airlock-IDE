import { readdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Claude Code stores each project's conversations under
// ~/.claude/projects/<cwd with every non-alphanumeric char replaced by '-'>/*.jsonl.
// Pure; the single source of this encoding.
export function claudeProjectsDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

// True iff `claude --continue` run in `root` would have a conversation to resume
// (the project's claude dir holds >=1 .jsonl). Best-effort; ANY error -> false so
// the caller falls back to a fresh claude (the safe direction). homeDir injectable
// for tests. Checks both the raw root and its realpath (claude may canonicalize cwd).
export async function hasResumableClaudeSession(
  root: string,
  homeDir: string = os.homedir(),
): Promise<boolean> {
  const names = new Set<string>([claudeProjectsDirName(root)]);
  try {
    names.add(claudeProjectsDirName(await realpath(root)));
  } catch {
    // root may not exist / not be resolvable; the raw-encoded candidate still tried
  }
  for (const name of names) {
    try {
      const entries = await readdir(
        path.join(homeDir, ".claude", "projects", name),
      );
      if (entries.some((f) => f.endsWith(".jsonl"))) return true;
    } catch {
      // dir missing -> not resumable under this candidate
    }
  }
  return false;
}
