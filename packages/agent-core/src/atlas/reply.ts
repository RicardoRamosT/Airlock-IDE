// ASCII comments only. Split one conversational turn into what the user sees
// and what Atlas remembers.
//
// Facts ride the SAME response as the reply, in a trailing delimited block, so
// a turn costs one request instead of two. Extracting them with a second call
// would double the cost of the thing the user does most.
//
// Every failure mode here strips the block anyway. A malformed or unterminated
// block must never reach the UI -- raw JSON in a chat bubble is the most
// visible possible bug in this feature.

import type { IncomingConcern } from "./concerns";
import { FACT_KINDS, type FactKind, type IncomingFact } from "./facts";

export const FACTS_OPEN = "<<<ATLAS_FACTS";
export const FACTS_CLOSE = "ATLAS_FACTS>>>";
export const CONCERNS_OPEN = "<<<ATLAS_CONCERNS";
export const CONCERNS_CLOSE = "ATLAS_CONCERNS>>>";

export interface SplitReply {
  prose: string;
  facts: IncomingFact[];
  concerns: IncomingConcern[];
}

function isKind(v: unknown): v is FactKind {
  return typeof v === "string" && (FACT_KINDS as readonly string[]).includes(v);
}

function toFact(raw: unknown): IncomingFact | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isKind(r.kind)) return null;
  if (typeof r.value !== "string" || r.value.trim().length === 0) return null;
  if (typeof r.verbatim !== "string") return null;
  const project =
    typeof r.project === "string" && r.project.trim().length > 0
      ? r.project.trim()
      : null;
  return { project, kind: r.kind, value: r.value, verbatim: r.verbatim };
}

function toConcern(raw: unknown): IncomingConcern | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.key !== "string" || r.key.trim().length === 0) return null;
  if (typeof r.title !== "string" || r.title.trim().length === 0) return null;
  return {
    key: r.key.trim(),
    project:
      typeof r.project === "string" && r.project.trim().length > 0
        ? r.project.trim()
        : null,
    title: r.title.trim(),
    detail: typeof r.detail === "string" ? r.detail : "",
    resolved: r.resolved === true,
  };
}

// Pull ONE delimited JSON-array block out, returning the entries it parsed and
// the text with the block removed. Every failure mode strips the block anyway:
// raw JSON in a chat bubble is the most visible possible bug in this feature.
function takeBlock<T>(
  text: string,
  openTag: string,
  closeTag: string,
  toEntry: (raw: unknown) => T | null,
): { rest: string; entries: T[] } {
  const open = text.indexOf(openTag);
  if (open < 0) return { rest: text, entries: [] };
  const rest = text.slice(0, open);
  const close = text.indexOf(closeTag, open);
  // An unterminated block is still stripped: the user sees the prose only.
  if (close < 0) return { rest, entries: [] };

  const after = text.slice(close + closeTag.length);
  const body = text.slice(open + openTag.length, close).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { rest: rest + after, entries: [] };
  }
  if (!Array.isArray(parsed)) return { rest: rest + after, entries: [] };

  const entries: T[] = [];
  for (const raw of parsed) {
    const e = toEntry(raw);
    if (e) entries.push(e);
  }
  return { rest: rest + after, entries };
}

export function splitReply(raw: string): SplitReply {
  // Concerns first, then facts: both blocks may be present, and each pass
  // removes its own so neither can leak into the prose the user reads.
  const c = takeBlock(raw, CONCERNS_OPEN, CONCERNS_CLOSE, toConcern);
  const f = takeBlock(c.rest, FACTS_OPEN, FACTS_CLOSE, toFact);
  return { prose: f.rest.trim(), facts: f.entries, concerns: c.entries };
}
