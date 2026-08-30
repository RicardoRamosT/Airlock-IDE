// ASCII comments only. Keeping the facts honest.
//
// This is the answer to what killed Helm. Helm's data rotted because keeping it
// current was a chore the user had to remember. Atlas instead asks ONE question
// a day, about the single oldest thing it still believes, phrased in the user's
// own words. The maintenance loop is real, but it is disguised as conversation
// -- and one question a day is a conversation, while two is an interrogation.

import type { AtlasFact } from "./facts";

const DAY = 24 * 60 * 60 * 1000;

export const STALE_AFTER_DAYS = 60;

export function isStale(fact: AtlasFact, now: number): boolean {
  // A superseded fact has already been replaced; re-asking about it would be
  // asking a question the user has answered.
  if (fact.supersededAt !== null) return false;
  return now - fact.saidAt > STALE_AFTER_DAYS * DAY;
}

// The oldest stale fact, or null. Returns null outright if a question was
// already asked today.
export function pickDailyQuestion(
  facts: readonly AtlasFact[],
  now: number,
  askedDay: string | null,
  today: string,
): AtlasFact | null {
  if (askedDay === today) return null;
  let best: AtlasFact | null = null;
  for (const f of facts) {
    if (!isStale(f, now)) continue;
    if (best === null || f.saidAt < best.saidAt) best = f;
  }
  return best;
}

function ago(ms: number): string {
  const days = Math.floor(ms / DAY);
  if (days < 60) return `${days} days ago`;
  const months = Math.round(days / 30);
  return `${months} months ago`;
}

export function questionFor(fact: AtlasFact, now: number): string {
  const who = fact.project ? `about ${fact.project}, ` : "";
  return `You said ${who}"${fact.verbatim}" ${ago(now - fact.saidAt)}. Still true?`;
}
