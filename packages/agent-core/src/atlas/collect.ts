// ASCII comments only. Turn a list of project roots into a snapshot. Every
// dependency is injected so the rules are testable with no filesystem and no
// git. Nothing here reads a fixed directory: the caller supplies the roots.
//
// Degradation is the design, not an afterthought. A missing path, a non-repo
// root, a repo with no remote, and a repo whose git call fails must each yield
// a SMALLER snapshot -- never an exception, and never a blank portfolio.

import type { GitStatus } from "../git/status";
import type { CommitEntry } from "./activity";

export interface RootSnapshot {
  root: string;
  missing: boolean; // path did not exist
  isRepo: boolean; // path exists AND is a git work tree
  branch: string | null;
  upstream: string | null; // null means no remote tracking branch
  ahead: number; // commits that exist only locally
  behind: number;
  dirty: number; // staged + unstaged + untracked
  commits: CommitEntry[]; // commits since the requested window start
}

export interface CollectDeps {
  exists(root: string): Promise<boolean>;
  isRepo(root: string): Promise<boolean>;
  status(root: string): Promise<GitStatus>;
  log(root: string, sinceMs: number): Promise<CommitEntry[]>;
}

function empty(root: string, missing: boolean, isRepo: boolean): RootSnapshot {
  return {
    root,
    missing,
    isRepo,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    dirty: 0,
    commits: [],
  };
}

export async function collectRoot(
  deps: CollectDeps,
  root: string,
  sinceMs: number,
): Promise<RootSnapshot> {
  if (!(await deps.exists(root))) return empty(root, true, false);
  if (!(await deps.isRepo(root))) return empty(root, false, false);

  const snap = empty(root, false, true);
  try {
    const st = await deps.status(root);
    snap.branch = st.branch.head;
    snap.upstream = st.branch.upstream;
    snap.ahead = st.branch.ahead;
    snap.behind = st.branch.behind;
    snap.dirty = st.staged.length + st.unstaged.length + st.untracked.length;
  } catch {
    // Leave the repo-shaped defaults in place. One broken repository must not
    // remove the other twenty from the snapshot.
  }
  try {
    snap.commits = await deps.log(root, sinceMs);
  } catch {
    // Activity is optional; the rest of the snapshot is still useful.
  }
  return snap;
}

// Bounded concurrency: a user may have hundreds of roots, and each root costs
// several git subprocesses. Order of the result always matches the input.
export async function collectAll(
  deps: CollectDeps,
  roots: readonly string[],
  sinceMs: number,
  concurrency = 8,
): Promise<RootSnapshot[]> {
  const out: RootSnapshot[] = new Array(roots.length);
  let next = 0;
  const limit = Math.max(1, concurrency);
  const workers = Array.from(
    { length: Math.min(limit, roots.length) },
    async () => {
      for (;;) {
        const i = next;
        next += 1;
        if (i >= roots.length) return;
        out[i] = await collectRoot(deps, roots[i] as string, sinceMs);
      }
    },
  );
  await Promise.all(workers);
  return out;
}
