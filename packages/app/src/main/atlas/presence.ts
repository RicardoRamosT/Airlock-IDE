// ASCII comments only. Does this project still exist?
//
// The answer has THREE values, because a failed check proves nothing. This is
// the whole reason the module exists: presence used to be one `fs.access` with
// a bare `catch { return false }`, so a path that is GONE and a path that
// could not be READ produced the same verdict -- and the verdict flags a
// project `missing`, which drops it from the debrief, from the spine's dots
// and from the long-running-apps monitor, saying nothing. A project on an
// unmounted drive, or one behind a macOS permission prompt, is not deleted.

import { access } from "node:fs/promises";
import type { RootPresence } from "@airlock/agent-core";

// ENOENT: the path is not there. ENOTDIR: a parent component is a file, so the
// path as written cannot exist either. Everything else -- EPERM and EACCES
// (macOS TCC, a folder in ~/Documents or on a removable volume), EIO, ELOOP,
// an unmounted network share -- means the question went unanswered.
const GONE = new Set(["ENOENT", "ENOTDIR"]);

// Exported so the classification is testable on its own: the interesting
// cases (EACCES, EIO, an unmounted share) are awkward to provoke and easy to
// fake, and a test that re-implements this rule instead of calling it proves
// nothing.
export function presenceForError(code: unknown): RootPresence {
  return typeof code === "string" && GONE.has(code) ? "gone" : "unknown";
}

export async function probeRoot(root: string): Promise<RootPresence> {
  try {
    await access(root);
    return "present";
  } catch (e) {
    return presenceForError((e as NodeJS.ErrnoException | null)?.code);
  }
}

/**
 * Probe every root. Cheap enough to run on every read of the project list:
 * one stat per project, no git, no subprocess -- against the per-root git that
 * refreshPortfolio spends, this is free, which is why presence no longer has
 * to wait for the once-a-day debrief to be corrected.
 */
export async function probeRoots(
  roots: readonly string[],
): Promise<Map<string, RootPresence>> {
  const out = new Map<string, RootPresence>();
  await Promise.all(
    roots.map(async (r) => {
      out.set(r, await probeRoot(r));
    }),
  );
  return out;
}
