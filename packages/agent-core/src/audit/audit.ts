import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ensureAirlockDir } from "../project/airlockDir";

export interface AuditEntry {
  ts: string;
  actor: "user" | "agent";
  op: string;
  detail: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

const GENESIS = "0".repeat(64);

// The exact top-level keys of a well-formed entry. verifyAuditChain rejects any
// entry whose key set differs: computeHash covers a FIXED, ordered 5-field
// subset (order-stable, robust to JSON key reordering), so an EXTRA top-level
// key would otherwise ride along unhashed and undetected. detail's contents are
// hashed wholesale, so nested keys are already covered. (audit L4)
const ENTRY_KEYS = new Set(["ts", "actor", "op", "detail", "prevHash", "hash"]);

function auditFile(root: string): string {
  return path.join(root, ".airlock", "audit", "log.jsonl");
}

function computeHash(e: Omit<AuditEntry, "hash">): string {
  const body = JSON.stringify({
    ts: e.ts,
    actor: e.actor,
    op: e.op,
    detail: e.detail,
    prevHash: e.prevHash,
  });
  return createHash("sha256").update(body).digest("hex");
}

// Parse one JSONL line into an entry, returning null on malformed JSON
// instead of throwing. A null marks a corrupt line so callers can decide:
// verifyAuditChain treats it as an integrity failure, readAudit skips it.
function parseEntry(line: string): AuditEntry | null {
  try {
    return JSON.parse(line) as AuditEntry;
  } catch {
    return null;
  }
}

// Split JSONL text into one slot per non-empty line; a null slot is a corrupt
// (unparseable) line. Shared by readEntries (file path) and appendAuditAt (which
// also needs the RAW text to detect a torn last line), so the parse rules live
// in one place.
function parseEntries(text: string): (AuditEntry | null)[] {
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => parseEntry(l));
}

// Returns one slot per non-empty line. Reading the file is best-effort: a
// missing/unreadable file yields no entries rather than throwing.
async function readEntries(logFile: string): Promise<(AuditEntry | null)[]> {
  try {
    return parseEntries(await readFile(logFile, "utf8"));
  } catch {
    return [];
  }
}

// Serialize appends per log file. appendAuditAt is a read-modify-write -- it
// reads the last hash, then appends an entry chained to it -- so two concurrent
// calls would read the SAME prevHash and fork the chain, which makes
// verifyAuditChain fail permanently (the second fork's prevHash never matches
// the running hash again). An in-process async mutex keyed by the resolved log
// path makes each append wait for the prior one to finish writing. This guards
// within ONE process, which is airlock's whole concurrency surface (every audit
// writer lives in the Electron main process); multiple processes sharing one log
// would additionally need an OS file lock. (audit C2)
const appendLocks = new Map<string, Promise<unknown>>();

function withAppendLock<T>(logFile: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(logFile);
  const prev = appendLocks.get(key) ?? Promise.resolve();
  // Run fn after prev settles -- resolved OR rejected -- so one failed append
  // cannot wedge the queue for this log.
  const run = prev.then(fn, fn);
  // Store a non-rejecting tail: the next caller chains cleanly and a failed
  // append leaves no unhandled rejection on the stored promise. The caller still
  // gets the real result/rejection via `run`.
  appendLocks.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

// Append a hash-chained entry to an EXPLICIT log file. Same chain logic as
// appendAudit, but the caller supplies the path directly rather than deriving
// it from a project root. Used for the app-global audit chain (under userData),
// which is not rooted in any one project folder. Serialized per log file so
// concurrent appends cannot fork the chain (see withAppendLock).
export async function appendAuditAt(
  logFile: string,
  actor: AuditEntry["actor"],
  op: string,
  detail: Record<string, unknown>,
  nowIso?: string,
): Promise<AuditEntry> {
  return withAppendLock(logFile, async () => {
    // Read the RAW log: we need it both to link to the last entry's hash AND to
    // detect a torn last line (the newline guard below).
    let raw = "";
    try {
      raw = await readFile(logFile, "utf8");
    } catch {
      raw = "";
    }
    // Skip corrupt lines and link to the last PARSEABLE entry's hash.
    const entries = parseEntries(raw).filter(
      (e): e is AuditEntry => e !== null,
    );
    const prevHash =
      entries.length > 0
        ? (entries[entries.length - 1]?.hash ?? GENESIS)
        : GENESIS;
    const partial = {
      ts: nowIso ?? new Date().toISOString(),
      actor,
      op,
      detail,
      prevHash,
    };
    const entry: AuditEntry = { ...partial, hash: computeHash(partial) };
    await mkdir(path.dirname(logFile), { recursive: true });
    // If the file does not end in a newline, a previous append was torn (process
    // died mid-write). Prefix a newline so the torn fragment stays its OWN
    // (corrupt) line instead of being glued onto -- and corrupting -- this entry.
    // readAudit then still recovers this and later entries. (audit H4)
    const sep = raw.length > 0 && !raw.endsWith("\n") ? "\n" : "";
    await appendFile(logFile, `${sep}${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  });
}

export async function appendAudit(
  root: string,
  actor: AuditEntry["actor"],
  op: string,
  detail: Record<string, unknown>,
  nowIso?: string,
): Promise<AuditEntry> {
  // Per-project audit lives in .airlock/ -- ensure it exists AND is gitignored
  // before the first append (appendAuditAt, shared with the userData global log,
  // only mkdirs the audit subdir and must not assume a project root).
  await ensureAirlockDir(root);
  return appendAuditAt(auditFile(root), actor, op, detail, nowIso);
}

export async function readAudit(
  root: string,
  limit?: number,
): Promise<AuditEntry[]> {
  // Best-effort display: skip corrupt lines rather than throwing on them.
  const entries = (await readEntries(auditFile(root))).filter(
    (e): e is AuditEntry => e !== null,
  );
  if (limit === undefined || entries.length <= limit) return entries;
  return entries.slice(entries.length - limit);
}

/**
 * Verifies integrity and linkage of all PRESENT entries. A corrupt
 * (unparseable) line makes the chain invalid (returns false) rather than
 * throwing. Silent truncation of trailing entries is undetectable by design
 * (no external head pointer).
 */
export async function verifyAuditChain(root: string): Promise<boolean> {
  const entries = await readEntries(auditFile(root));
  let prev = GENESIS;
  for (const e of entries) {
    // A corrupt (unparseable) line is an integrity failure, not a crash.
    if (e === null) return false;
    // Reject an unexpected top-level key set: an extra key is not covered by the
    // 5-field hash, so it must not pass verification. (audit L4)
    const keys = Object.keys(e);
    if (keys.length !== ENTRY_KEYS.size || keys.some((k) => !ENTRY_KEYS.has(k)))
      return false;
    if (e.prevHash !== prev) return false;
    const { hash, ...rest } = e;
    if (computeHash(rest) !== hash) return false;
    prev = hash;
  }
  return true;
}
