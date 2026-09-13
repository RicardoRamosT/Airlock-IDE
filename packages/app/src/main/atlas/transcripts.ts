// ASCII comments only. Find and stream a project's Claude Code transcripts.
//
// STREAMED, never readFile. The largest active transcript on the author's
// machine measured 78.1 MB; loading one into a string to find a title would
// spike main's heap for no reason.
//
// Path encoding is claudeProjectsDirName's job -- it is the single source of
// that rule, and the realpath fallback mirrors hasResumableClaudeSession
// because claude may canonicalize cwd.
import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import {
  claudeProjectsDirName,
  digestSession,
  type SessionDigest,
  type TranscriptRecord,
} from "@airlock/agent-core";

async function candidateDirs(root: string, homeDir: string): Promise<string[]> {
  const names = new Set<string>([claudeProjectsDirName(root)]);
  try {
    names.add(claudeProjectsDirName(await realpath(root)));
  } catch {
    // unresolvable root: the raw-encoded candidate is still tried
  }
  return [...names].map((n) => path.join(homeDir, ".claude", "projects", n));
}

async function digestFile(
  file: string,
  sinceMs: number,
  untilMs: number,
): Promise<SessionDigest | null> {
  const records: TranscriptRecord[] = [];
  const rl = readline.createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  try {
    for await (const line of rl) {
      if (!line) continue;
      try {
        records.push(JSON.parse(line) as TranscriptRecord);
      } catch {
        // one corrupt line must not cost the session its digest
      }
    }
  } finally {
    rl.close();
  }
  return digestSession(
    path.basename(file, ".jsonl"),
    records,
    sinceMs,
    untilMs,
  );
}

export async function readDigests(
  root: string,
  sinceMs: number,
  untilMs: number,
  homeDir: string = os.homedir(),
): Promise<SessionDigest[]> {
  const out: SessionDigest[] = [];
  for (const dir of await candidateDirs(root, homeDir)) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue; // no transcripts for this root, which is a normal state
    }
    for (const name of entries) {
      if (!name.endsWith(".jsonl")) continue;
      const file = path.join(dir, name);
      try {
        // mtime is a cheap pre-filter: a file untouched since before the
        // window cannot contain a record inside it.
        if ((await stat(file)).mtimeMs < sinceMs) continue;
        const d = await digestFile(file, sinceMs, untilMs);
        if (d) out.push(d);
      } catch {
        // unreadable transcript -> fewer digests, never a thrown standup
      }
    }
  }
  return out.sort((a, b) => b.endedAt - a.endedAt);
}
