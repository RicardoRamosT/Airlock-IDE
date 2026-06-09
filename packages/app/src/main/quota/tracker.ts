import type { QuotaStatus } from "../../shared/ipc";
import { mergeQuota } from "./parse";

interface Entry {
  status: QuotaStatus;
  activeAt: number; // session's transcript mtime: when it was last truly active
  emitAt: number; // when it last wrote the side-channel file
}

// The quota side-channel file is shared by ALL Claude sessions on the machine,
// and refreshInterval makes even an IDLE session keep re-emitting -- so a long-
// idle session re-writes a STALE snapshot (an expired rate-limit window) that
// would otherwise clobber the active session's live data and make the meter
// flicker. This tracker keeps the latest reading PER session and always yields
// the reading of the most-recently-ACTIVE session (by transcript activity), so
// an idle session never wins. Sessions that stop emitting are pruned.
export class QuotaTracker {
  private readonly bySession = new Map<string, Entry>();

  constructor(private readonly staleAfterSec = 120) {}

  // Record one session's emit; returns the reading to broadcast now (or null).
  record(
    sessionId: string,
    status: QuotaStatus,
    activeAt: number,
    emitAt: number,
  ): QuotaStatus | null {
    const prev = this.bySession.get(sessionId);
    this.bySession.set(sessionId, {
      // Merge within the session so a transient rate-limit-less emit (a fresh
      // session pre-first-response) does not blank that session's reading.
      status: mergeQuota(prev?.status ?? null, status),
      activeAt,
      emitAt,
    });
    return this.current(emitAt);
  }

  // The most-recently-active session's reading, after pruning dead sessions.
  current(now: number): QuotaStatus | null {
    for (const [sid, e] of this.bySession) {
      if (now - e.emitAt > this.staleAfterSec) this.bySession.delete(sid);
    }
    let best: Entry | null = null;
    for (const e of this.bySession.values()) {
      if (!best || e.activeAt > best.activeAt) best = e;
    }
    return best?.status ?? null;
  }
}
