import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createFileSink,
  type EmitInput,
  type EventFilter,
  EventWriter,
  filterEvents,
  type Level,
  type LogEvent,
  levelAtLeast,
  parseEventLog,
  redactEvent,
} from "@airlock/agent-core";
import { app } from "electron";

const CAPACITY = 10_000;
const FLUSH_THRESHOLD = 256;
const FLUSH_MS = 1_000;
const MAX_BYTES = 8 * 1024 * 1024;
const KEEP_FILES = 5;

let writer: EventWriter | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let minLevel: Level = "debug";
let logFileOverride: string | null = null;

export function eventLogPath(): string {
  return (
    logFileOverride ?? path.join(app.getPath("userData"), "events", "log.jsonl")
  );
}

// Test seam: point reads/writes at a temp file (keeps the unit test off electron).
export function __setLogFileForTest(file: string): void {
  logFileOverride = file;
}

export function startEventLog(opts: {
  enabled: boolean;
  minLevel: Level;
}): void {
  stopEventLog();
  if (!opts.enabled) return;
  minLevel = opts.minLevel;
  writer = new EventWriter(
    createFileSink(eventLogPath(), {
      maxBytes: MAX_BYTES,
      keepFiles: KEEP_FILES,
    }),
    { capacity: CAPACITY, flushThreshold: FLUSH_THRESHOLD },
  );
  timer = setInterval(() => {
    const w = writer;
    if (!w) return;
    const dropped = w.takeDropped();
    if (dropped > 0) {
      emitEvent({
        level: "warn",
        category: "eventlog",
        op: "events.dropped",
        detail: { dropped },
      });
    }
    void w.flush();
  }, FLUSH_MS);
  // Do not keep the process alive just for the flush timer.
  if (typeof timer.unref === "function") timer.unref();
}

export function stopEventLog(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  writer = null;
}

// Synchronous, never throws, never blocks. Below-minLevel events are dropped.
export function emitEvent(input: EmitInput): void {
  const w = writer;
  if (!w) return;
  if (!levelAtLeast(input.level, minLevel)) return;
  try {
    w.emit(redactEvent({ ...input, ts: new Date().toISOString() }));
  } catch {
    // logging must never throw into a caller
  }
}

export function flushEventLog(): Promise<void> {
  return writer ? writer.flush() : Promise.resolve();
}

export async function queryEvents(filter: EventFilter): Promise<LogEvent[]> {
  try {
    const text = await readFile(eventLogPath(), "utf8");
    return filterEvents(parseEventLog(text), filter);
  } catch {
    return [];
  }
}
