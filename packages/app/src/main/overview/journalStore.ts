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
  MAX_BULK,
  readJournal,
  sanitizeNewEntries,
  sanitizeNewEntry,
  serializeEntry,
  sortByTs,
  uniqueTs,
  updateNote,
  updateNotes,
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

// Append MANY entries in one read + one atomic write (bulk import). Populating a
// changelog one entry at a time costs a whole-file read+rewrite per entry (O(n^2)
// I/O) and 80 broadcasts; this does it once. Each item is
// `{ text, tag?, details?, ts? }` -- an explicit ts (epoch ms) preserves a
// historical date. Invalid items are skipped and reported, not fatal. The merged
// set is sorted by ts so an out-of-order import still displays chronologically.
export async function appendJournalEntries(
  root: string,
  items: unknown,
  nowMs: number,
): Promise<
  | { ok: true; added: number; skipped: number; entries: JournalEntry[] }
  | { ok: false; error: string }
> {
  if (!Array.isArray(items))
    return { ok: false, error: "entries must be an array." };
  if (items.length === 0)
    return { ok: false, error: "entries is empty (nothing to add)." };
  if (items.length > MAX_BULK)
    return {
      ok: false,
      error: `Too many entries in one call (${items.length} > ${MAX_BULK}); split the import.`,
    };
  const all = await readAll(root);
  const { entries, skipped } = sanitizeNewEntries(items, all, nowMs);
  if (entries.length === 0)
    return { ok: false, error: "No valid entries (text empty or too long)." };
  try {
    await writeAll(root, sortByTs([...all, ...entries]));
    return { ok: true, added: entries.length, skipped, entries };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Edit MANY notes by ts in one read + one atomic write. Notes only (the
// git-derived Changes rows stay read-only); unmatched/invalid rows are skipped
// and reported. Errors only when NOTHING matched or the write fails.
export async function updateNoteEntries(
  root: string,
  updates: unknown,
): Promise<
  | { ok: true; updated: number; skipped: number }
  | { ok: false; error: string }
> {
  if (!Array.isArray(updates))
    return { ok: false, error: "updates must be an array." };
  if (updates.length === 0)
    return { ok: false, error: "updates is empty (nothing to change)." };
  if (updates.length > MAX_BULK)
    return {
      ok: false,
      error: `Too many updates in one call (${updates.length} > ${MAX_BULK}); split the batch.`,
    };
  const all = await readAll(root);
  const next = updateNotes(all, updates);
  if (next.updated === 0)
    return { ok: false, error: "No notes matched (or every text was invalid)." };
  try {
    await writeAll(root, next.entries);
    return { ok: true, updated: next.updated, skipped: next.skipped };
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
