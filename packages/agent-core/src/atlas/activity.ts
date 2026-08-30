// ASCII comments only. Parse `git log` output into commit entries. The format
// uses ASCII unit/record separators rather than a printable delimiter, because
// commit subjects routinely contain pipes and tabs, and a wrapped subject can
// carry a newline. A printable delimiter would corrupt real data.

const US = "\x1f"; // unit separator: between fields
const RS = "\x1e"; // record separator: between commits

export const COMMIT_LOG_FORMAT = `%H${US}%ct${US}%s${RS}`;

export interface CommitEntry {
  hash: string;
  at: number; // epoch MILLISECONDS (git reports %ct in seconds)
  subject: string;
}

// Tolerant by design: a malformed record is skipped, never thrown on. A single
// odd commit in one repository must not blank the whole portfolio snapshot.
export function parseCommitLog(raw: string): CommitEntry[] {
  const out: CommitEntry[] = [];
  for (const record of raw.split(RS)) {
    if (record.trim().length === 0) continue;
    const fields = record.split(US);
    if (fields.length < 3) continue;
    const hash = (fields[0] as string).trim();
    const seconds = Number.parseInt(fields[1] as string, 10);
    if (hash.length === 0) continue;
    if (!Number.isFinite(seconds)) continue;
    out.push({ hash, at: seconds * 1000, subject: fields.slice(2).join(US) });
  }
  return out;
}
