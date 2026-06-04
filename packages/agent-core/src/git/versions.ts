import { readWorkspaceFile } from "../workspace/read";
import { resolveWithin } from "../workspace/tree";
import { runGit } from "./run";

export type DiffSide = "staged" | "unstaged";

export interface FileVersions {
  original: string;
  modified: string;
  binary: boolean;
}

async function gitShow(root: string, ref: string): Promise<string | null> {
  try {
    return await runGit(root, ["show", ref]);
  } catch {
    // Path absent at that ref (untracked / newly added / deleted there).
    return null;
  }
}

async function worktreeContent(root: string, relPath: string): Promise<string> {
  try {
    return (await readWorkspaceFile(root, relPath)).content;
  } catch {
    // Deleted in the worktree.
    return "";
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
  if (which === "staged") {
    original = (await gitShow(root, `HEAD:${relPath}`)) ?? "";
    modified = (await gitShow(root, `:0:${relPath}`)) ?? "";
  } else {
    original = (await gitShow(root, `:0:${relPath}`)) ?? "";
    modified = await worktreeContent(root, relPath);
  }
  const binary = original.includes("\0") || modified.includes("\0");
  return { original, modified, binary };
}
