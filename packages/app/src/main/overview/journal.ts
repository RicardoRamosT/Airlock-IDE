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

// Return ts if free, else the next ts+k (k>=1) not already used. Keeps ts a
// stable per-entry key so edit/delete can target by ts without an id field.
export function uniqueTs(entries: JournalEntry[], ts: number): number {
  const used = new Set(entries.map((e) => e.ts));
  let t = ts;
  while (used.has(t)) t += 1;
  return t;
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
