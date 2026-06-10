import type { SessionUsage } from "../../../shared/ipc";

export interface ModelAggregate {
  model: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costUsd: number;
  apiMs: number;
}

// Group sessions by model (null -> "unknown"), sum the numerics, sort by
// output tokens -- the "what costs more" ordering on subscription plans
// where reported USD is zero.
export function aggregateByModel(sessions: SessionUsage[]): ModelAggregate[] {
  const byModel = new Map<string, ModelAggregate>();
  for (const s of sessions) {
    const model = s.model ?? "unknown";
    const agg = byModel.get(model) ?? {
      model,
      sessions: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      costUsd: 0,
      apiMs: 0,
    };
    agg.sessions += 1;
    agg.inputTokens += s.totalInputTokens;
    agg.outputTokens += s.totalOutputTokens;
    agg.cacheReadTokens += s.cacheReadTokens;
    agg.cacheCreateTokens += s.cacheCreateTokens;
    agg.costUsd += s.costUsd;
    agg.apiMs += s.apiMs;
    byModel.set(model, agg);
  }
  return [...byModel.values()].sort((a, b) => b.outputTokens - a.outputTokens);
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatApiTime(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function formatUsd(n: number): string {
  if (n <= 0) return "—";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}
