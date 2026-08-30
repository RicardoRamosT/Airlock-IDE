// ASCII comments only. What the user told Atlas.
//
// This is the half of the portfolio git cannot see: deadlines, priorities,
// "ezlis is dead", "LOS is blocked on the lender API". It only ever arrives by
// the user SAYING it -- there is no form anywhere in Atlas, because a form is
// what Helm had and what nobody filled in.
//
// A fact is never deleted. When it changes, the old one is marked superseded
// and keeps the verbatim sentence that produced it, so "why do you think that?"
// always has an answer.

export type FactKind = "deadline" | "priority" | "status" | "blocker" | "note";

export const FACT_KINDS: readonly FactKind[] = [
  "deadline",
  "priority",
  "status",
  "blocker",
  "note",
];

export interface AtlasFact {
  id: string;
  project: string | null; // null means portfolio-wide
  kind: FactKind;
  value: string;
  verbatim: string; // the user's own words, never paraphrased
  saidAt: number; // epoch ms
  supersededAt: number | null; // epoch ms when replaced, else null
}

export interface IncomingFact {
  project: string | null;
  kind: FactKind;
  value: string;
  verbatim: string;
}

// One project holds one live fact per kind: a second deadline for the same
// project replaces the first rather than sitting beside it.
export function factKey(f: { project: string | null; kind: FactKind }): string {
  return `${f.project ?? "*"} ${f.kind}`;
}

export function mergeFacts(
  existing: readonly AtlasFact[],
  incoming: readonly IncomingFact[],
  now: number,
  id: (n: number) => string,
): AtlasFact[] {
  const out = existing.map((f) => ({ ...f }));
  let n = 0;
  for (const raw of incoming) {
    const value = raw.value.trim();
    if (value.length === 0) continue;
    const key = factKey(raw);
    for (const f of out) {
      if (f.supersededAt === null && factKey(f) === key) f.supersededAt = now;
    }
    out.push({
      id: id(n),
      project: raw.project,
      kind: raw.kind,
      value,
      verbatim: raw.verbatim,
      saidAt: now,
      supersededAt: null,
    });
    n += 1;
  }
  return out;
}

export function liveFacts(facts: readonly AtlasFact[]): AtlasFact[] {
  return facts.filter((f) => f.supersededAt === null);
}
