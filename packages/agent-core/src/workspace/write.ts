import { writeFile } from "node:fs/promises";
import { resolveWithin, targetsVault } from "./tree";

// Write UTF-8 text to a workspace file (the GUI editor's save). resolveWithin
// enforces that relPath stays INSIDE root, so a save can never escape the
// project. Overwrites in place; the file must already exist (editing). v1 is
// last-write-wins -- external-change detection arrives with file-watching.
export async function writeWorkspaceFile(
  root: string,
  relPath: string,
  content: string,
): Promise<void> {
  // Self-guard: never write into the .airlock vault (secret metadata + the audit
  // chain). The fs:writeFile handler rejects it too, but guarding here covers
  // EVERY caller -- a forged write into .airlock could destroy or rewrite the
  // tamper-evident audit log and the vault metadata. (audit C7)
  if (targetsVault(relPath))
    throw new Error("The .airlock folder is protected");
  const abs = await resolveWithin(root, relPath);
  await writeFile(abs, content, "utf8");
}
