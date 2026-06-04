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
): Promise<{ content: string; truncated: boolean }> {
  try {
    const { content, truncated } = await readWorkspaceFile(root, relPath);
    return { content, truncated };
  } catch {
    // Deleted in the worktree.
    return { content: "", truncated: false };
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
  if (which === "staged") {
    original = (await gitShow(root, `HEAD:${relPath}`)) ?? "";
    modified = (await gitShow(root, `:0:${relPath}`)) ?? "";
    truncated = false;
  } else {
    original = (await gitShow(root, `:0:${relPath}`)) ?? "";
    const wt = await worktreeContent(root, relPath);
    modified = wt.content;
    truncated = wt.truncated;
  }
  const binary = original.includes("\0") || modified.includes("\0");
  return { original, modified, binary, truncated };
}
