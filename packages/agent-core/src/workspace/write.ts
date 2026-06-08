import { writeFile } from "node:fs/promises";
import { resolveWithin } from "./tree";

// Write UTF-8 text to a workspace file (the GUI editor's save). resolveWithin
// enforces that relPath stays INSIDE root, so a save can never escape the
// project. Overwrites in place; the file must already exist (editing). v1 is
// last-write-wins -- external-change detection arrives with file-watching.
export async function writeWorkspaceFile(
  root: string,
  relPath: string,
  content: string,
): Promise<void> {
  const abs = await resolveWithin(root, relPath);
  await writeFile(abs, content, "utf8");
}
