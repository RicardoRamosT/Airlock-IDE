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

import { FACT_KINDS, type FactKind, type IncomingFact } from "./facts";

export const FACTS_OPEN = "<<<ATLAS_FACTS";
export const FACTS_CLOSE = "ATLAS_FACTS>>>";

export interface SplitReply {
  prose: string;
  facts: IncomingFact[];
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

export function splitReply(raw: string): SplitReply {
  const open = raw.indexOf(FACTS_OPEN);
  if (open < 0) return { prose: raw.trim(), facts: [] };

  const prose = raw.slice(0, open).trim();
  const close = raw.indexOf(FACTS_CLOSE, open);
  // An unterminated block is still stripped: the user sees the prose only.
  if (close < 0) return { prose, facts: [] };

  const body = raw.slice(open + FACTS_OPEN.length, close).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { prose, facts: [] };
  }
  if (!Array.isArray(parsed)) return { prose, facts: [] };

  const facts: IncomingFact[] = [];
  for (const entry of parsed) {
    const f = toFact(entry);
    if (f) facts.push(f);
  }
  return { prose, facts };
}
