import { rename, stat, unlink, writeFile } from "node:fs/promises";
import { resolveWithin, targetsVault } from "./tree";

export interface WriteWorkspaceFileOptions {
  // The mtime the caller last SAW. When given, the write is refused if the file
  // has changed since. Omit it to force an overwrite (an explicit user choice).
  expectMtimeMs?: number;
}

export interface WriteWorkspaceFileResult {
  // The new baseline. A caller that keeps writing MUST adopt this, or its next
  // save compares against a stale value and refuses itself.
  mtimeMs: number;
}

// Thrown when the file changed underneath the caller. Typed so the UI can offer
// "reload or overwrite" instead of showing a generic save failure.
export class StaleWriteError extends Error {
  constructor(relPath: string) {
    super(`${relPath} changed on disk since it was opened`);
    this.name = "StaleWriteError";
  }
}

// Write UTF-8 text to a workspace file (the GUI editor's save). resolveWithin
// enforces that relPath stays INSIDE root, so a save can never escape the
// project.
//
// Two properties this must have, both learned the hard way:
//
// ATOMIC. It was a bare writeFile, i.e. O_TRUNC: a crash between the truncate
// and the write leaves the user's source file EMPTY. prefs.json has been
// written atomically for ages; the user's actual code was not. temp+rename
// means a concurrent reader sees the old bytes or the new bytes, never none.
//
// GUARDED. `expectMtimeMs` is how the editor avoids putting a stale buffer over
// a file something else rewrote -- Claude editing it, `git switch`, a formatter
// on save. Without it the editor's 800ms autosave silently destroyed that work:
// the write path had no way to even express staleness, because FileContent
// carried no mtime.
//
// The check is inherently TOCTOU -- a writer landing between the stat and the
// rename still wins -- but it closes the window from "800ms of typing" to
// "microseconds", which is the difference between a routine loss and a race
// nobody will hit.
export async function writeWorkspaceFile(
  root: string,
  relPath: string,
  content: string,
  opts: WriteWorkspaceFileOptions = {},
): Promise<WriteWorkspaceFileResult> {
  // Self-guard: never write into the .airlock vault (secret metadata + the audit
  // chain). The fs:writeFile handler rejects it too, but guarding here covers
  // EVERY caller -- a forged write into .airlock could destroy or rewrite the
  // tamper-evident audit log and the vault metadata. (audit C7)
  if (targetsVault(relPath))
    throw new Error("The .airlock folder is protected");
  const abs = await resolveWithin(root, relPath);

  // Current state: absent is fine (a new file), and carries no mode to keep.
  let mode: number | undefined;
  let currentMtimeMs: number | null = null;
  try {
    const st = await stat(abs);
    mode = st.mode & 0o777;
    currentMtimeMs = st.mtimeMs;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  if (opts.expectMtimeMs !== undefined && currentMtimeMs !== opts.expectMtimeMs)
    throw new StaleWriteError(relPath);

  // Unique temp name: two writers must never share one, and a leftover from a
  // killed process must not be adopted by the next write.
  const tmp = `${abs}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    // rename does NOT carry the destination's mode, so set it on the temp file
    // before the swap or an executable script quietly loses its +x.
    await writeFile(
      tmp,
      content,
      mode === undefined ? "utf8" : { encoding: "utf8", mode },
    );
    await rename(tmp, abs);
  } catch (e) {
    // Never leave a temp file beside the user's source.
    await unlink(tmp).catch(() => {});
    throw e;
  }
  return { mtimeMs: (await stat(abs)).mtimeMs };
}
