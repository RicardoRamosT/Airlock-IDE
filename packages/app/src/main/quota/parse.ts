import type {
  QuotaStatus,
  QuotaWindow,
  SessionUsage,
} from "../../shared/ipc";

function parseWindow(raw: unknown): QuotaWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.used_percentage === "number" &&
    Number.isFinite(r.used_percentage) &&
    typeof r.resets_at === "number" &&
    Number.isFinite(r.resets_at)
  ) {
    return {
      usedPercentage: Math.min(100, Math.max(0, r.used_percentage)),
      resetsAt: Math.floor(r.resets_at),
    };
  }
  return null;
}

function parseModel(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const m = raw as Record<string, unknown>;
    if (typeof m.display_name === "string") return m.display_name;
    if (typeof m.id === "string") return m.id;
  }
  return null;
}

function unavailable(now: number): QuotaStatus {
  return {
    fiveHour: null,
    sevenDay: null,
    model: null,
    updatedAt: now,
    available: false,
  };
}

// Parse the raw statusLine JSON the emitter captured into a QuotaStatus. `now`
// is epoch seconds (injected for testability). Defensive: every field optional;
// empty/garbage input or missing rate_limits -> available:false.
export function parseQuota(text: string, now: number): QuotaStatus {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return unavailable(now);
  }
  if (!json || typeof json !== "object") return unavailable(now);
  const r = json as Record<string, unknown>;
  const rl = (r.rate_limits ?? {}) as Record<string, unknown>;
  const fiveHour = parseWindow(rl.five_hour);
  const sevenDay = parseWindow(rl.seven_day);
  return {
    fiveHour,
    sevenDay,
    model: parseModel(r.model),
    updatedAt: now,
    available: fiveHour !== null || sevenDay !== null,
  };
}

// Fold a freshly-parsed status onto the last-known one. A fresh Claude Code
// session renders its statusLine BEFORE the first API response, and rate_limits
// are absent until then -- so that first emit parses to no windows. Without this
// merge it would clobber good data with "unavailable" for a few seconds (read as
// "limit reached"). Each window/model is carried forward when the new emit lacks
// it, so we only ever go from data -> better data, never data -> blank.
export function mergeQuota(
  prev: QuotaStatus | null,
  next: QuotaStatus,
): QuotaStatus {
  if (!prev) return next;
  const fiveHour = next.fiveHour ?? prev.fiveHour;
  const sevenDay = next.sevenDay ?? prev.sevenDay;
  return {
    fiveHour,
    sevenDay,
    model: next.model ?? prev.model,
    updatedAt: next.updatedAt,
    available: fiveHour !== null || sevenDay !== null,
  };
}

export interface SessionMeta {
  sessionId: string | null;
  transcriptPath: string | null;
}

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

// Extract one session's cumulative usage from a raw statusLine payload.
// Defensive like parseQuota: absent cost/context_window become zeros; only a
// missing session_id (or non-JSON) yields null.
export function parseSessionUsage(
  text: string,
  emitAt: number,
): SessionUsage | null {
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!r || typeof r !== "object" || typeof r.session_id !== "string")
    return null;
  const cw = (r.context_window ?? {}) as Record<string, unknown>;
  const cu = (cw.current_usage ?? {}) as Record<string, unknown>;
  const cost = (r.cost ?? {}) as Record<string, unknown>;
  return {
    sessionId: r.session_id,
    cwd: typeof r.cwd === "string" ? r.cwd : null,
    model: parseModel(r.model),
    totalInputTokens: num(cw.total_input_tokens),
    totalOutputTokens: num(cw.total_output_tokens),
    cacheReadTokens: num(cu.cache_read_input_tokens),
    cacheCreateTokens: num(cu.cache_creation_input_tokens),
    costUsd: num(cost.total_cost_usd),
    apiMs: num(cost.total_api_duration_ms),
    linesAdded: num(cost.total_lines_added),
    linesRemoved: num(cost.total_lines_removed),
    lastEmitAt: emitAt,
  };
}

// Fold one snapshot into the ledger: latest emit per session wins; past the
// cap the OLDEST-emitting session is evicted (history, not liveness, decides).
export function recordUsage(
  ledger: Map<string, SessionUsage>,
  u: SessionUsage,
  cap = 50,
): void {
  ledger.set(u.sessionId, u);
  if (ledger.size <= cap) return;
  let oldest: string | null = null;
  let oldestAt = Number.POSITIVE_INFINITY;
  for (const [id, s] of ledger) {
    if (s.lastEmitAt < oldestAt) {
      oldestAt = s.lastEmitAt;
      oldest = id;
    }
  }
  if (oldest !== null) ledger.delete(oldest);
}

// Pull the identifying fields out of the raw statusLine payload: which session
// wrote it, and where its transcript lives (used to gauge how recently that
// session was actually active). Tolerant of garbage/missing fields.
export function parseSessionMeta(text: string): SessionMeta {
  try {
    const r = JSON.parse(text) as Record<string, unknown>;
    return {
      sessionId: typeof r.session_id === "string" ? r.session_id : null,
      transcriptPath:
        typeof r.transcript_path === "string" ? r.transcript_path : null,
    };
  } catch {
    return { sessionId: null, transcriptPath: null };
  }
}
