import type { QuotaStatus } from "../../shared/ipc";
import { mergeQuota } from "./parse";

interface Entry {
  status: QuotaStatus;
  activeAt: number; // session's transcript mtime: when it was last truly active
  emitAt: number; // when it last wrote the side-channel file
}

// The quota side-channel file is shared by ALL Claude sessions on the machine,
// and refreshInterval makes even an IDLE session keep re-emitting -- so a long-
// idle session (a VS Code panel, an old terminal) re-writes a STALE snapshot
// that would otherwise clobber live data and make the meter flicker. This
// tracker keeps the latest reading PER session and yields, among sessions that
// are STILL EMITTING (live window), the freshest account-wide snapshot:
// usage only climbs within a rate-limit window and resets_at only moves
// forward, so (resetsAt, usedPercentage) orders snapshots by the recency of
// their underlying API response -- regardless of whose transcript moved last
// (transcript activity remains the final tiebreak). The live gate also stops
// a session that went SILENT (but is not yet pruned) from shadowing live ones
// with a frozen updatedAt, which the UI would read as "no active session".
export class QuotaTracker {
  private readonly bySession = new Map<string, Entry>();

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

  // The freshest live session's reading, after pruning dead sessions.
  current(now: number): QuotaStatus | null {
    for (const [sid, e] of this.bySession) {
      if (now - e.emitAt > this.staleAfterSec) this.bySession.delete(sid);
    }
    let best: Entry | null = null;
    for (const e of this.bySession.values()) {
      if (now - e.emitAt > this.liveAfterSec) continue; // silent: cannot represent the meter
      if (!best || fresher(e, best)) best = e;
    }
    return best?.status ?? null;
  }
}

// Snapshot order: later rate-limit window first, then higher usage within the
// window (account-wide usage is monotone until reset), then transcript
// activity as the tiebreak between equally-fresh snapshots.
const key = (e: Entry): [number, number, number] => [
  e.status.fiveHour?.resetsAt ?? 0,
  e.status.fiveHour?.usedPercentage ?? -1,
  e.activeAt,
];

function fresher(a: Entry, b: Entry): boolean {
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < ka.length; i++) {
    const va = ka[i] as number;
    const vb = kb[i] as number;
    if (va !== vb) return va > vb;
  }
  return false;
}
