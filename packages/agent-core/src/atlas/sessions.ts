// ASCII comments only. What a Claude Code session remembers, distilled from the
// records it already wrote to disk.
//
// Everything here is free. Claude Code writes an ai-title per session, a
// compaction summary at every compaction boundary, and the whole conversation;
// the standup reads them rather than paying a model to reconstruct any of it.
// Measured 2026-09-12: resuming a real session to rebuild the same distillation
// costs ~950K input tokens, because that is how large these sessions get.
//
// These are Claude Code INTERNALS, not a documented API. Every field is treated
// as optional and every malformed record is skipped. If a future release stops
// writing titles, the standup loses richness and keeps its ledger -- it must
// never throw.

export interface TranscriptRecord {
  type?: string;
  timestamp?: string;
  aiTitle?: string;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  compactMetadata?: unknown;
  message?: unknown;
}

export interface SessionDigest {
  id: string;
  title: string | null;
  startedAt: number;
  endedAt: number;
  userMessages: number;
  compactSummaries: string[]; // only those written INSIDE the window
  lastPrompt: string | null;
  tail: string;
}

export const TAIL_TURNS = 20;
export const TAIL_CHARS = 8000;

function textOf(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) =>
      b &&
      typeof b === "object" &&
      typeof (b as { text?: unknown }).text === "string"
        ? (b as { text: string }).text
        : "",
    )
    .join("");
}

function stamp(r: TranscriptRecord): number | null {
  if (typeof r.timestamp !== "string") return null;
  const ms = Date.parse(r.timestamp);
  return Number.isFinite(ms) ? ms : null;
}

export function digestSession(
  id: string,
  records: readonly TranscriptRecord[],
  sinceMs: number,
  untilMs: number,
): SessionDigest | null {
  let title: string | null = null;
  let startedAt = Number.POSITIVE_INFINITY;
  let endedAt = 0;
  let userMessages = 0;
  let lastPrompt: string | null = null;
  const compactSummaries: string[] = [];
  const turns: string[] = [];

  for (const r of records) {
    if (!r || typeof r !== "object") continue;
    // The title record carries no timestamp; take the last one seen, which is
    // Claude Code's most recent rewrite of it.
    if (r.type === "ai-title") {
      if (typeof r.aiTitle === "string" && r.aiTitle.trim()) title = r.aiTitle;
      continue;
    }

    const at = stamp(r);
    if (at === null) continue;

    if (r.isCompactSummary === true || r.compactMetadata) {
      const text = textOf(r.message).trim();
      // Window-filtered on purpose: see the module comment and the test.
      if (text && at >= sinceMs && at <= untilMs) compactSummaries.push(text);
      continue;
    }

    if (at < sinceMs || at > untilMs) continue;
    if (at < startedAt) startedAt = at;
    if (at > endedAt) endedAt = at;

    const text = textOf(r.message).trim();
    if (r.type === "user" && r.isMeta !== true) {
      userMessages += 1;
      if (text) lastPrompt = text;
    }
    if (text) turns.push(`${r.type === "user" ? "me" : "claude"}: ${text}`);
  }

  if (userMessages === 0 && compactSummaries.length === 0) return null;
  if (!Number.isFinite(startedAt)) startedAt = endedAt;

  const tail = turns.slice(-TAIL_TURNS).join("\n").slice(-TAIL_CHARS);
  return {
    id,
    title,
    startedAt,
    endedAt,
    userMessages,
    compactSummaries,
    lastPrompt,
    tail,
  };
}
