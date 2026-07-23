// packages/app/src/main/overview/journalStore.ts
// Thin fs wiring for the Changelog journal (.airlock/journal.jsonl). Decisions
// live in journal.ts. Never throws; a missing file reads as empty.
//
// ASCII-only comments (CJS-bundled into Electron main).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { JournalEntry } from "../../shared/ipc";
import {
  capEntries,
  readJournal,
  sanitizeNewEntry,
  serializeEntry,
} from "./journal";

function journalPath(root: string): string {
  return path.join(root, ".airlock", "journal.jsonl");
}

async function readAll(root: string): Promise<JournalEntry[]> {
  try {
    return readJournal(await readFile(journalPath(root), "utf8"));
  } catch {
    return [];
  }
}

// Append one entry (capped, atomic write of the whole set). Returns the stored
// entry, or an error for empty/oversize text.
export async function appendJournalEntry(
  root: string,
  text: unknown,
  tag: unknown,
  nowMs: number,
  details?: unknown,
): Promise<{ ok: true; entry: JournalEntry } | { ok: false; error: string }> {
  const entry = sanitizeNewEntry(text, tag, nowMs, details);
  if (!entry)
    return { ok: false, error: "Changelog text is empty or too long." };
  try {
    const next = capEntries([...(await readAll(root)), entry]);
    await mkdir(path.join(root, ".airlock"), { recursive: true });
    const file = journalPath(root);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, `${next.map(serializeEntry).join("\n")}\n`, "utf8");
    await rename(tmp, file);
    return { ok: true, entry };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Recent entries, newest-first, capped to `limit`.
export async function readRecentJournal(
  root: string,
  limit: number,
): Promise<JournalEntry[]> {
  const all = await readAll(root);
  return all.slice(Math.max(0, all.length - limit)).reverse();
}
