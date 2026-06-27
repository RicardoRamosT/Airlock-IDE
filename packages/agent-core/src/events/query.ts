import { type Level, type LogEvent, levelAtLeast } from "./types";

export interface EventFilter {
  level?: Level; // minimum level
  category?: string; // exact match
  op?: string; // prefix match
  project?: string; // exact match
  since?: string; // ISO; keep events with ts >= since
  limit?: number; // keep the last N after filtering
}

export function filterEvents(
  events: LogEvent[],
  f: EventFilter = {},
): LogEvent[] {
  let out = events.filter((e) => {
    if (f.level && !levelAtLeast(e.level, f.level)) return false;
    if (f.category && e.category !== f.category) return false;
    if (f.op && !e.op.startsWith(f.op)) return false;
    if (f.project && e.project !== f.project) return false;
    if (f.since && e.ts < f.since) return false;
    return true;
  });
  if (f.limit && f.limit > 0 && out.length > f.limit) {
    out = out.slice(out.length - f.limit);
  }
  return out;
}

// Parse JSONL into events, skipping corrupt lines (best-effort, like readAudit).
export function parseEventLog(text: string): LogEvent[] {
  const out: LogEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      out.push(JSON.parse(line) as LogEvent);
    } catch {
      // skip corrupt line
    }
  }
  return out;
}
