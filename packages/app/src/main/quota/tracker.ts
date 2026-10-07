import type { QuotaStatus, QuotaWindow } from "../../shared/ipc";

// The quota side-channel file is shared by ALL Claude sessions on the machine,
// and refreshInterval makes even an IDLE session keep re-emitting a STALE
// snapshot. Account-wide usage is MONOTONE within a rate-limit window (it only
// climbs until resets_at), so the tracker FOLDS every emit into a best-known
// value per window: a higher percentage within the same window raises it and
// nothing ever lowers it -- an ended session's final (highest) reading persists
// even after it stops emitting, and an idle session's ancient snapshot can never
// drag the meter back down. Sessions themselves are tracked for LIVENESS: the
// meter shows data while at least one session emitted recently (updatedAt =
// that emit), and goes silent otherwise.
//
// WHICH window is current is decided by RECENCY OF PRODUCTION, not by which
// window ends last. "A later resets_at is a newer window" holds only within
// ONE account, and a machine can carry two: after switching Claude accounts,
// idle sessions keep re-emitting the OLD account's frozen snapshot, and when
// the old account's week happened to end later, that rule pinned it (seen
// 2026-10-07: the meter read 70% of the old week while the logged-in account
// sat at 0%). The payload names no account, so the tracker instead asks which
// reading an API response delivered most recently -- the logged-in account is
// the one still answering.
export class QuotaTracker {
  private readonly bySession = new Map<string, SessionSeen>();
  private readonly fiveHour = new Map<number, Candidate>();
  private readonly sevenDay = new Map<number, Candidate>();

  constructor(
    private readonly staleAfterSec = 120,
    // Must exceed the statusLine refreshInterval (5s) plus jitter, and stay
    // at or below the UI's STALE_AFTER_SECONDS-ish horizon so a silent
    // session is dropped before the meter would blank.
    private readonly liveAfterSec = 20,
  ) {}

  // Record one session's emit; returns the reading to broadcast now (or null).
  // `apiMs` is the session's cumulative API time (null when the payload has
  // none): it climbs exactly when an API response arrives, which is when the
  // session's rate_limits are refreshed.
  record(
    sessionId: string,
    status: QuotaStatus,
    emitAt: number,
    apiMs: number | null,
  ): QuotaStatus | null {
    const prev = this.bySession.get(sessionId);
    const sig = readingSignature(status);
    // New data arrived iff this session's API time climbed or its reading
    // changed since its last emit. A FIRST sighting proves nothing -- an idle
    // session re-emits whatever it last saw, however old -- so its production
    // time stays unknown (0) until it is seen to move.
    const produced =
      prev !== undefined &&
      (sig !== prev.sig ||
        (apiMs !== null && prev.apiMs !== null && apiMs > prev.apiMs));
    const producedAt = produced ? emitAt : (prev?.producedAt ?? 0);
    this.bySession.set(sessionId, {
      emitAt,
      model: status.model,
      apiMs,
      sig,
      producedAt,
    });
    // An emit carrying ANY already-expired window is a provably stale snapshot.
    // Seen live (2026-06-10): a resumed/forked Claude session re-emits
    // transcript-vintage rate_limits until its first own turn completes -- its
    // 5h window had expired ~20h earlier, but its 7d shared the live week's
    // resets_at, so the monotone fold latched the old (higher) percentage with
    // no recovery until the week ended. The sibling windows of an expired one
    // share its vintage: trust nothing from such an emit. (The session still
    // counts for LIVENESS above -- it is alive, just feeding old numbers.)
    if (
      !isExpired(status.fiveHour, emitAt) &&
      !isExpired(status.sevenDay, emitAt)
    ) {
      fold(this.fiveHour, status.fiveHour, producedAt, FIVE_HOUR_SECONDS);
      fold(this.sevenDay, status.sevenDay, producedAt, SEVEN_DAY_SECONDS);
    }
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
    // A picked window whose reset has passed is FINISHED. Hiding it read as
    // "no limit" (QA 2026-06-11), so synthesize a zeroed awaiting row instead:
    // the next window starts on the user's next message, so its reset time is
    // unknowable here; resetsAt keeps the OLD boundary as an ended-at stamp
    // and the flag tells consumers to show "starts on next use", never a
    // countdown. Nothing known stays null.
    const fiveHour = expireToAwaiting(pick(this.fiveHour, now), now);
    const sevenDay = expireToAwaiting(pick(this.sevenDay, now), now);
    return {
      fiveHour,
      sevenDay,
      model,
      updatedAt: liveAt,
      available: fiveHour !== null || sevenDay !== null,
    };
  }
}

const FIVE_HOUR_SECONDS = 5 * 3600;
const SEVEN_DAY_SECONDS = 7 * 86400;

interface SessionSeen {
  emitAt: number;
  model: string | null;
  apiMs: number | null;
  sig: string; // the session's last reading, to notice it change
  producedAt: number; // last emit that carried NEW data; 0 = never seen to
}

// One window's best-known reading, keyed by its resets_at.
interface Candidate {
  usedPercentage: number;
  resetsAt: number;
  // When this reading was last delivered by an API response, as best we know.
  producedAt: number;
}

function readingSignature(s: QuotaStatus): string {
  const w = (x: QuotaWindow | null) =>
    x ? `${x.usedPercentage}@${x.resetsAt}` : "-";
  return `${w(s.fiveHour)}|${w(s.sevenDay)}`;
}

// Fold one reading into its window's candidate: within a window usage only
// climbs, so keep the max. The production time is floored at the window's
// START -- a window reports nothing before it begins, so a reading of a window
// that started after another ENDED was necessarily produced after it. That
// floor is what lets a new window whose producer we never saw move (we poll one
// shared file and miss most emits) still replace an ended one, and it keeps the
// unobserved case identical to the old "later resets_at wins" rule.
function fold(
  windows: Map<number, Candidate>,
  w: QuotaWindow | null,
  producedAt: number,
  lengthSec: number,
): void {
  if (!w) return;
  const at = Math.max(producedAt, w.resetsAt - lengthSec);
  const c = windows.get(w.resetsAt);
  if (!c) {
    windows.set(w.resetsAt, {
      usedPercentage: w.usedPercentage,
      resetsAt: w.resetsAt,
      producedAt: at,
    });
    return;
  }
  c.usedPercentage = Math.max(c.usedPercentage, w.usedPercentage);
  c.producedAt = Math.max(c.producedAt, at);
}

// The current window: the one most recently delivered, ties to the later
// reset. Expired losers are dropped -- their production time is frozen (an
// expired emit is never folded) and can never overtake the pick again.
function pick(
  windows: Map<number, Candidate>,
  now: number,
): QuotaWindow | null {
  let best: Candidate | null = null;
  for (const c of windows.values()) {
    if (
      !best ||
      c.producedAt > best.producedAt ||
      (c.producedAt === best.producedAt && c.resetsAt > best.resetsAt)
    )
      best = c;
  }
  for (const [k, c] of windows) {
    if (c !== best && isExpired(c, now)) windows.delete(k);
  }
  return best
    ? { usedPercentage: best.usedPercentage, resetsAt: best.resetsAt }
    : null;
}

function expireToAwaiting(
  w: QuotaWindow | null,
  now: number,
): QuotaWindow | null {
  if (w === null || !isExpired(w, now)) return w;
  return { usedPercentage: 0, resetsAt: w.resetsAt, awaitingNextWindow: true };
}

// Whether a window's reset boundary has already passed at `at` -- i.e. the
// reading describes a finished window and says nothing about the current one.
function isExpired(w: { resetsAt: number } | null, at: number): boolean {
  return w !== null && w.resetsAt <= at;
}
