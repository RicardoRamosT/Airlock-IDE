import { runGit } from "./run";

export interface BranchInfo {
  head: string;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface FileChange {
  path: string;
  index: string;
  worktree: string;
  origPath: string | null;
}

export interface GitStatus {
  branch: BranchInfo;
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: string[];
}

/**
 * Parse `git status --porcelain=v2 --branch -z` output. With -z, entries are
 * NUL-separated and a rename entry's ORIGINAL path arrives as the following
 * NUL token. Paths are unquoted in -z mode, so spaces survive intact.
 */
export function parsePorcelainV2(raw: string): GitStatus {
  const branch: BranchInfo = {
    head: "(detached)",
    upstream: null,
    ahead: 0,
    behind: 0,
  };
  const staged: FileChange[] = [];
  const unstaged: FileChange[] = [];
  const untracked: string[] = [];
  const tokens = raw.split("\0").filter((t) => t.length > 0);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;
    if (t.startsWith("# branch.head ")) {
      branch.head = t.slice("# branch.head ".length);
      continue;
    }
    if (t.startsWith("# branch.upstream ")) {
      branch.upstream = t.slice("# branch.upstream ".length);
      continue;
    }
    if (t.startsWith("# branch.ab ")) {
      const m = t.match(/\+(\d+) -(\d+)/);
      if (m) {
        branch.ahead = Number(m[1]);
        branch.behind = Number(m[2]);
      }
      continue;
    }
    if (t.startsWith("# ")) continue;
    if (t.startsWith("? ")) {
      untracked.push(t.slice(2));
      continue;
    }
    if (t.startsWith("1 ") || t.startsWith("2 ")) {
      const isRename = t.startsWith("2 ");
      // 1 XY sub mH mI mW hH hI path  (8 fields before path)
      // 2 XY sub mH mI mW hH hI Xscore path  (9 fields before path)
      const fieldCount = isRename ? 9 : 8;
      const parts = t.split(" ");
      const xy = parts[1] ?? "..";
      const filePath = parts.slice(fieldCount).join(" ");
      const origPath = isRename ? (tokens[++i] ?? null) : null;
      const change: FileChange = {
        path: filePath,
        index: xy[0] ?? ".",
        worktree: xy[1] ?? ".",
        origPath,
      };
      if (change.index !== ".") staged.push(change);
      if (change.worktree !== ".") unstaged.push(change);
      continue;
    }
    if (t.startsWith("u ")) {
      // unmerged: u XY sub m1 m2 m3 mW h1 h2 h3 path (10 fields before path)
      const parts = t.split(" ");
      const filePath = parts.slice(10).join(" ");
      unstaged.push({
        path: filePath,
        index: "U",
        worktree: "U",
        origPath: null,
      });
    }
  }
  return { branch, staged, unstaged, untracked };
}

export async function gitStatus(root: string): Promise<GitStatus> {
  const raw = await runGit(root, [
    "status",
    "--porcelain=v2",
    "--branch",
    "-z",
    "--untracked-files=all",
  ]);
  return parsePorcelainV2(raw);
}
