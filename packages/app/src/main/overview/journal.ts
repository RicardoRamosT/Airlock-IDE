// packages/app/src/main/overview/journal.ts
// Pure model + parsing for the per-project Changelog journal
// (.airlock/journal.jsonl). No I/O -- journalStore.ts does the fs. Types live in
// shared/ipc.ts so the renderer can use them too.
//
// ASCII-only comments (CJS-bundled into Electron main).
import type { JournalEntry, JournalTag } from "../../shared/ipc";

export const JOURNAL_TAGS: readonly JournalTag[] = [
  "change",
  "fix",
  "decision",
  "note",
];
export const MAX_ENTRIES = 500;
const MAX_TEXT = 2000;
export const MAX_DETAILS = 8000;
// Per-call batch ceiling for the bulk add/update paths. Bounds one agent call's
// work (and its JSON payload); larger imports split across calls. Well above the
// realistic "populate a changelog" batch, and under MAX_ENTRIES.
export const MAX_BULK = 200;

function isTag(v: unknown): v is JournalTag {
  return (
    typeof v === "string" && (JOURNAL_TAGS as readonly string[]).includes(v)
  );
}

// Parse one JSONL line -> entry, or null if unusable. Unknown tag -> "note".
export function parseJournalLine(line: string): JournalEntry | null {
  const t = line.trim();
  if (!t) return null;
  let o: unknown;
  try {
    o = JSON.parse(t);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  if (typeof r.ts !== "number" || !Number.isFinite(r.ts) || r.ts <= 0)
    return null;
  if (typeof r.text !== "string" || r.text.trim() === "") return null;
  const entry: JournalEntry = {
    ts: r.ts,
    tag: isTag(r.tag) ? r.tag : "note",
    text: r.text,
  };
  if (typeof r.details === "string" && r.details.trim() !== "")
    entry.details = r.details;
  return entry;
}

export function serializeEntry(e: JournalEntry): string {
  const o: Record<string, unknown> = { ts: e.ts, tag: e.tag, text: e.text };
  if (e.details) o.details = e.details;
  return JSON.stringify(o);
}

// Validate/normalize an incoming append. Empty/oversize/non-string text -> null.
export function sanitizeNewEntry(
  text: unknown,
  tag: unknown,
  nowMs: number,
  details?: unknown,
): JournalEntry | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.length > MAX_TEXT) return null;
  const entry: JournalEntry = {
    ts: nowMs,
    tag: isTag(tag) ? tag : "note",
    text: trimmed,
  };
  if (typeof details === "string") {
    const d = details.trim();
    if (d !== "") entry.details = d.slice(0, MAX_DETAILS);
  }
  return entry;
}

export function readJournal(fileText: string): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (const line of fileText.split("\n")) {
    const e = parseJournalLine(line);
    if (e) out.push(e);
  }
  return out;
}

export function capEntries(
  entries: JournalEntry[],
  max = MAX_ENTRIES,
): JournalEntry[] {
  return entries.length > max ? entries.slice(entries.length - max) : entries;
}

// Next ts not present in `used` (ts+k, k>=0). Set-based so a batch can reserve
// each slot as it goes without rebuilding the used set per item.
function nextFreeTs(used: Set<number>, ts: number): number {
  let t = ts;
  while (used.has(t)) t += 1;
  return t;
}

// Return ts if free, else the next ts+k (k>=1) not already used. Keeps ts a
// stable per-entry key so edit/delete can target by ts without an id field.
export function uniqueTs(entries: JournalEntry[], ts: number): number {
  return nextFreeTs(new Set(entries.map((e) => e.ts)), ts);
}

// Validate/normalize a BATCH of appends against the existing set (bulk import).
// Each item may carry its own `ts` (epoch ms) so historical entries keep their
// real dates; otherwise it lands at nowMs. Every ts is then bumped to the next
// free slot -- including against earlier items in the SAME batch -- because ts is
// the per-entry key edit/delete target (80 appends in one millisecond would
// otherwise all collide). Invalid items are skipped and counted rather than
// failing the whole import.
export function sanitizeNewEntries(
  items: readonly unknown[],
  existing: readonly JournalEntry[],
  nowMs: number,
): { entries: JournalEntry[]; skipped: number } {
  const used = new Set(existing.map((e) => e.ts));
  const entries: JournalEntry[] = [];
  let skipped = 0;
  for (const raw of items) {
    if (!raw || typeof raw !== "object") {
      skipped++;
      continue;
    }
    const r = raw as Record<string, unknown>;
    const at =
      typeof r.ts === "number" && Number.isFinite(r.ts) && r.ts > 0
        ? Math.floor(r.ts)
        : nowMs;
    const entry = sanitizeNewEntry(r.text, r.tag, at, r.details);
    if (!entry) {
      skipped++;
      continue;
    }
    entry.ts = nextFreeTs(used, entry.ts);
    used.add(entry.ts);
    entries.push(entry);
  }
  return { entries, skipped };
}

// Sort chronologically (stable, so equal ts keeps insertion order). The bulk add
// path sorts the merged set because readRecentJournal treats the tail of FILE
// order as "newest" -- an import of historical entries appended at the end would
// otherwise display as the most recent ones.
export function sortByTs(entries: readonly JournalEntry[]): JournalEntry[] {
  return [...entries].sort((a, b) => a.ts - b.ts);
}

// Replace a NOTE entry's text/details (by ts). Returns a new array, or null if
// no note has that ts / text is empty|oversize. Non-note entries are never
// touched -- the git-derived Changes record is read-only.
export function updateNote(
  entries: JournalEntry[],
  ts: number,
  text: unknown,
  details?: unknown,
): JournalEntry[] | null {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed === "" || trimmed.length > MAX_TEXT) return null;
  let found = false;
  const out = entries.map((e) => {
    if (!found && e.ts === ts && e.tag === "note") {
      found = true;
      const next: JournalEntry = { ts: e.ts, tag: "note", text: trimmed };
      if (typeof details === "string") {
        const d = details.trim();
        if (d !== "") next.details = d.slice(0, MAX_DETAILS);
      }
      return next;
    }
    return e;
  });
  return found ? out : null;
}

// Apply a BATCH of note edits (each `{ ts, text, details? }`), folding one onto
// the next. Delegates to updateNote per item so the note-only invariant and the
// text validation can never drift from the single-edit path. An item that does
// not match a note (or whose text is invalid) is skipped and counted, so one bad
// row cannot fail the rest of the batch.
export function updateNotes(
  entries: JournalEntry[],
  updates: readonly unknown[],
): { entries: JournalEntry[]; updated: number; skipped: number } {
  let cur = entries;
  let updated = 0;
  let skipped = 0;
  for (const raw of updates) {
    if (!raw || typeof raw !== "object") {
      skipped++;
      continue;
    }
    const r = raw as Record<string, unknown>;
    const next =
      typeof r.ts === "number" && Number.isFinite(r.ts)
        ? updateNote(cur, r.ts, r.text, r.details)
        : null;
    if (next) {
      cur = next;
      updated++;
    } else skipped++;
  }
  return { entries: cur, updated, skipped };
}

// Remove one NOTE entry (by ts). Returns a new array, or null if none matched.
export function deleteNote(
  entries: JournalEntry[],
  ts: number,
): JournalEntry[] | null {
  let found = false;
  const out = entries.filter((e) => {
    if (!found && e.ts === ts && e.tag === "note") {
      found = true;
      return false;
    }
    return true;
  });
  return found ? out : null;
}
