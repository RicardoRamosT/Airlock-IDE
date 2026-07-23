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
  deleteNote,
  readJournal,
  sanitizeNewEntry,
  serializeEntry,
  uniqueTs,
  updateNote,
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

// Atomic whole-file write of the capped set (tmp + rename). Throws on fs error.
async function writeAll(root: string, entries: JournalEntry[]): Promise<void> {
  const next = capEntries(entries);
  await mkdir(path.join(root, ".airlock"), { recursive: true });
  const file = journalPath(root);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${next.map(serializeEntry).join("\n")}\n`, "utf8");
  await rename(tmp, file);
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
    await writeAll(root, [...(await readAll(root)), entry]);
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

// Add a note (tag=note) with a collision-free ts. Returns the stored entry.
export async function addNoteEntry(
  root: string,
  text: unknown,
  details: unknown,
  nowMs: number,
): Promise<{ ok: true; entry: JournalEntry } | { ok: false; error: string }> {
  const all = await readAll(root);
  const entry = sanitizeNewEntry(text, "note", uniqueTs(all, nowMs), details);
  if (!entry) return { ok: false, error: "Note text is empty or too long." };
  try {
    await writeAll(root, [...all, entry]);
    return { ok: true, entry };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Edit a note by ts (note-only). Error if no note matched / write fails.
export async function updateNoteEntry(
  root: string,
  ts: number,
  text: unknown,
  details?: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const next = updateNote(await readAll(root), ts, text, details);
  if (!next) return { ok: false, error: "Note not found or text invalid." };
  try {
    await writeAll(root, next);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Delete a note by ts (note-only). Error if no note matched / write fails.
export async function deleteNoteEntry(
  root: string,
  ts: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const next = deleteNote(await readAll(root), ts);
  if (!next) return { ok: false, error: "Note not found." };
  try {
    await writeAll(root, next);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
