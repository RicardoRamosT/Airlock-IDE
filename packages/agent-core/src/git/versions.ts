import { readWorkspaceFile } from "../workspace/read";
import { resolveWithin } from "../workspace/tree";
import { runGit } from "./run";

export type DiffSide = "staged" | "unstaged";

export interface FileVersions {
  original: string;
  modified: string;
  binary: boolean;
  truncated: boolean;
}

async function gitShow(root: string, ref: string): Promise<string | null> {
  try {
    return await runGit(root, ["show", ref]);
  } catch {
    // Path absent at that ref (untracked / newly added / deleted there).
    return null;
  }
}

// If relPath is the destination of a STAGED rename/copy, return the SOURCE path
// so the diff's "original" can be the source's HEAD content (HEAD:<newPath> does
// not exist, so without this the diff shows an empty original -- as if the file
// were brand new). `-M` enables rename detection; `--name-status -z` emits
// "R<score>\0<src>\0<dst>\0" for a rename/copy and "<status>\0<path>\0" for
// everything else. Null when relPath is not a staged rename destination. (audit M2)
async function stagedRenameSource(
  root: string,
  relPath: string,
): Promise<string | null> {
  let out: string;
  try {
    out = await runGit(root, ["diff", "--cached", "-M", "--name-status", "-z"]);
  } catch {
    return null;
  }
  const t = out.split("\0");
  let i = 0;
  while (i < t.length) {
    const status = t[i];
    if (!status) break; // trailing empty token
    if (status.startsWith("R") || status.startsWith("C")) {
      const src = t[i + 1];
      if (t[i + 2] === relPath && src) return src;
      i += 3; // status + src + dst
    } else {
      i += 2; // status + single path
    }
  }
  return null;
}

async function worktreeContent(
  root: string,
  relPath: string,
): Promise<{ content: string; truncated: boolean; binary: boolean }> {
  try {
    const { content, truncated, binary } = await readWorkspaceFile(
      root,
      relPath,
    );
    return { content, truncated, binary };
  } catch {
    // Deleted in the worktree.
    return { content: "", truncated: false, binary: false };
  }
}

export async function gitFileVersions(
  root: string,
  relPath: string,
  which: DiffSide,
): Promise<FileVersions> {
  // Containment first - the renderer echoes paths back from status output,
  // but never trust the echo.
  await resolveWithin(root, relPath);
  let original: string;
  let modified: string;
  let truncated: boolean;
  // readWorkspaceFile now empties a binary worktree file's content (so the
  // editor never shows byte-soup), so the worktree side reports binary via its
  // flag rather than a NUL scan of the (now empty) content. The git-show sides
  // still carry raw bytes, so the NUL scan covers original/staged.
  let worktreeBinary = false;
  if (which === "staged") {
    // A staged rename's destination has no HEAD:<newPath>; diff against the
    // renamed-FROM path's HEAD content instead of showing an empty original.
    const renameSrc = await stagedRenameSource(root, relPath);
    original =
      (renameSrc !== null
        ? await gitShow(root, `HEAD:${renameSrc}`)
        : await gitShow(root, `HEAD:${relPath}`)) ?? "";
    modified = (await gitShow(root, `:0:${relPath}`)) ?? "";
    truncated = false;
  } else {
    original = (await gitShow(root, `:0:${relPath}`)) ?? "";
    const wt = await worktreeContent(root, relPath);
    modified = wt.content;
    truncated = wt.truncated;
    worktreeBinary = wt.binary;
  }
  const binary =
    worktreeBinary || original.includes("\0") || modified.includes("\0");
  return { original, modified, binary, truncated };
}
