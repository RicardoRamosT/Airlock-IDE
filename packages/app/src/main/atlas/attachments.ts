// ASCII comments only. Images the user pastes into the Atlas chat.
//
// Atlas talks to `claude -p`, whose prompt is plain text -- there is nowhere to
// put image bytes. But Atlas is allowed the Read tool, and Claude Code's Read
// renders an image file. So a pasted screenshot is written to a file and the
// message names its path; Atlas opens it the same way it opens any other file.
//
// The directory is passed to the CLI as an --add-dir, so the read is explicitly
// permitted rather than relying on it happening to sit under the process cwd.
//
// Kept OUT of any project root on purpose: a screenshot is a message to Atlas,
// not a file in the user's repository, and writing one into a project would put
// it in front of git.

import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

// Only formats a clipboard actually produces, and only ones Read can display.
// An unknown mime is REJECTED rather than guessed at: writing bytes under a
// wrong extension gives Atlas a file it cannot open and the user no reason why.
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

// Object.hasOwn, NOT a plain lookup: MIME_EXT["constructor"] resolves up the
// prototype chain to a function, which `?? null` happily passes through as a
// valid extension.
export function extensionForMime(mime: unknown): string | null {
  if (typeof mime !== "string" || !Object.hasOwn(MIME_EXT, mime)) return null;
  return MIME_EXT[mime] ?? null;
}

// A screenshot of a 6K display runs to a few megabytes; a paste much larger
// than this is not a screenshot, and the prompt would be no more useful for it.
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

// How many to keep. These are transient message attachments, not a library, and
// an unbounded directory of screenshots would quietly grow forever.
export const KEEP_ATTACHMENTS = 40;

export function attachmentsDir(userDataPath: string): string {
  return path.join(userDataPath, "atlas-attachments");
}

// Deletes all but the newest `keep`. Best effort: a file that vanishes under us
// (or will not delete) must never fail the paste that triggered the sweep.
export function pruneAttachments(dir: string, keep = KEEP_ATTACHMENTS): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const stamped: { file: string; mtime: number }[] = [];
  for (const file of entries) {
    try {
      stamped.push({ file, mtime: statSync(path.join(dir, file)).mtimeMs });
    } catch {
      // Gone already; nothing to prune.
    }
  }
  stamped.sort((a, b) => b.mtime - a.mtime);
  for (const { file } of stamped.slice(keep)) {
    try {
      unlinkSync(path.join(dir, file));
    } catch {
      // Best effort.
    }
  }
}

// Returns the absolute path written, or null when the mime is not a supported
// image or the payload is too big. Never throws for those cases: a bad paste is
// a no-op, not an error dialog.
export function saveAttachment(
  dir: string,
  bytes: Uint8Array,
  mime: unknown,
): string | null {
  const ext = extensionForMime(mime);
  if (ext === null) return null;
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES)
    return null;
  mkdirSync(dir, { recursive: true });
  // randomUUID, not the original filename: a clipboard image has no meaningful
  // name, and an attacker-influenced one has no business steering a path.
  const file = path.join(dir, `${randomUUID()}.${ext}`);
  writeFileSync(file, bytes);
  pruneAttachments(dir);
  return file;
}

// How an attached image is announced in the message text. Explicit about the
// tool to use, because the path alone leaves Atlas guessing whether to Read it
// or treat it as a string.
export function describeAttachments(paths: readonly string[]): string {
  if (paths.length === 0) return "";
  const list = paths.map((p) => `- ${p}`).join("\n");
  const noun = paths.length === 1 ? "an image" : "images";
  return `\n\n[The user attached ${noun}. Use the Read tool on each path to view it:\n${list}\n]`;
}
