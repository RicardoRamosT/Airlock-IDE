import type { QuotaStatus, QuotaWindow } from "../../shared/ipc";

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
