import type { LogEvent } from "./types";

export type Sink = (batch: LogEvent[]) => Promise<void>;

export interface WriterOpts {
  capacity: number; // ring-buffer max; emits beyond this drop the oldest
  flushThreshold: number; // flush once this many events are pending
}

// In-memory buffered writer. emit() is sync, O(1), and never throws; flush()
// drains the pending batch to the sink, serialized so two flushes cannot
// double-write or interleave. Backpressure = drop-oldest (bounded memory).
export class EventWriter {
  private buf: LogEvent[] = [];
  private seq = 0;
  private dropped = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly sink: Sink,
    private readonly opts: WriterOpts,
  ) {}

  emit(input: Omit<LogEvent, "seq">): void {
    this.buf.push({ ...input, seq: this.seq++ });
    if (this.buf.length > this.opts.capacity) {
      const over = this.buf.length - this.opts.capacity;
      this.buf.splice(0, over); // drop oldest
      this.dropped += over;
    }
    if (this.buf.length >= this.opts.flushThreshold) void this.flush();
  }

  flush(): Promise<void> {
    const run = this.chain.then(async () => {
      if (this.buf.length === 0) return;
      const batch = this.buf;
      this.buf = [];
      try {
        await this.sink(batch);
      } catch {
        // best-effort: a failed sink drops this batch rather than crashing
      }
    });
    // Non-rejecting tail so one failed flush cannot wedge the queue.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // Read-and-reset the count of events dropped since the last call (the wire
  // layer turns a non-zero count into a visible `events.dropped` marker).
  takeDropped(): number {
    const n = this.dropped;
    this.dropped = 0;
    return n;
  }
}
