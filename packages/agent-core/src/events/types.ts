export type Level = "debug" | "info" | "warn" | "error";

export interface LogEvent {
  ts: string; // ISO timestamp
  seq: number; // monotonic per-process; assigned by the writer
  level: Level;
  category: string; // "lifecycle" | "ipc" | "db" | "command" | "console" | ...
  op: string; // "db.ping", "ipc.<channel>", "project.open", ...
  project?: string; // project root path; absent for app-level events
  actor?: "user" | "agent" | "system";
  outcome?: "ok" | "error" | "blocked";
  durationMs?: number;
  detail?: Record<string, unknown>; // redacted, secret-free
  error?: { message: string; stack?: string }; // redacted
}

// What app code passes to emitEvent: no writer-assigned seq, no caller ts.
export type EmitInput = Omit<LogEvent, "seq" | "ts">;

export const LEVELS: readonly Level[] = ["debug", "info", "warn", "error"];

export function levelAtLeast(level: Level, min: Level): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(min);
}
