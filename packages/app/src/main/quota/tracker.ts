import type { QuotaStatus, QuotaWindow } from "../../shared/ipc";

// The quota side-channel file is shared by ALL Claude sessions on the machine,
// and refreshInterval makes even an IDLE session keep re-emitting a STALE
// snapshot. Account-wide usage is MONOTONE within a rate-limit window (it only
// climbs until resets_at, and resets_at only moves forward), so the tracker
// FOLDS every emit into a best-known value per window: a later window replaces
// the fold, a higher percentage within the same window raises it, and nothing
// ever lowers it -- an ended session's final (highest) reading persists even
// after it stops emitting, and an idle session's ancient snapshot can never
// drag the meter back down. Sessions themselves are tracked only for
// LIVENESS: the meter shows data while at least one session emitted recently
// (updatedAt = that emit), and goes silent otherwise.
export class QuotaTracker {
  private readonly bySession = new Map<
    string,
    { emitAt: number; model: string | null }
  >();
  private best5h: QuotaWindow | null = null;
  private best7d: QuotaWindow | null = null;

  constructor(
    private readonly staleAfterSec = 120,
    // Must exceed the statusLine refreshInterval (5s) plus jitter, and stay
    // at or below the UI's STALE_AFTER_SECONDS-ish horizon so a silent
    // session is dropped before the meter would blank.
    private readonly liveAfterSec = 20,
  ) {}

  // Record one session's emit; returns the reading to broadcast now (or null).
  record(
    sessionId: string,
    status: QuotaStatus,
    emitAt: number,
  ): QuotaStatus | null {
    this.bySession.set(sessionId, { emitAt, model: status.model });
    this.best5h = foldWindow(this.best5h, status.fiveHour);
    this.best7d = foldWindow(this.best7d, status.sevenDay);
    return this.current(emitAt);
  }

  // The best-known account reading, stamped with the freshest LIVE emit; null
  // when no session is feeding the meter.
  current(now: number): QuotaStatus | null {
    let liveAt = -1;
    let model: string | null = null;
    for (const [sid, e] of this.bySession) {
      if (now - e.emitAt > this.staleAfterSec) {
        this.bySession.delete(sid);
        continue;
      }
      if (now - e.emitAt <= this.liveAfterSec && e.emitAt > liveAt) {
        liveAt = e.emitAt;
        model = e.model;
      }
    }
    if (liveAt < 0) return null;
    return {
      fiveHour: this.best5h,
      sevenDay: this.best7d,
      model,
      updatedAt: liveAt,
      available: this.best5h !== null || this.best7d !== null,
    };
  }
}

// Monotone fold for one window: a later resets_at means a NEW window (take the
// new reading wholesale); within the same window, usage only climbs, so keep
// the max; an older-window report is stale noise.
function foldWindow(
  prev: QuotaWindow | null,
  next: QuotaWindow | null,
): QuotaWindow | null {
  if (!next) return prev;
  if (!prev || next.resetsAt > prev.resetsAt) return next;
  if (next.resetsAt < prev.resetsAt) return prev;
  return next.usedPercentage > prev.usedPercentage ? next : prev;
}
