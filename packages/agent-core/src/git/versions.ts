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
    original = (await gitShow(root, `HEAD:${relPath}`)) ?? "";
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
