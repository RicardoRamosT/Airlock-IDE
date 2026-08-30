// ASCII comments only. When the debrief composes.
//
// On ARRIVAL, not on a clock. A 09:00 job produces a stale brief when the day
// starts at 11:00 and a wasted one on a day with no work. This fires the first
// time the user is actually present on a new calendar day.
//
// Focus fires constantly as the user switches applications, so every guard
// here exists to make sure exactly one compose happens per day.

export interface TriggerState {
  enabled: boolean; // the Atlas pref
  acknowledged: boolean; // the user accepted the first-run cost disclosure
  lastBriefDay: string | null; // day key of the last stored brief, or null
  today: string; // day key for now, in the USER's local time
  composing: boolean; // a compose is already in flight
  localHour: number; // 0-23, the user's local clock hour right now
  earliestHour: number; // 0-23, the configured "not before" hour
}

export function shouldCompose(s: TriggerState): boolean {
  if (!s.enabled) return false;
  if (!s.acknowledged) return false;
  if (s.composing) return false;
  // The day rolls over at midnight, but nobody wants a debrief at 00:01. The
  // user picks the hour their day starts; before it, Atlas simply waits.
  if (s.localHour < s.earliestHour) return false;
  if (s.lastBriefDay === null) return true;
  // Day keys are YYYY-MM-DD, so a string compare is a date compare. Strictly
  // less-than also means a stored day in the FUTURE (clock change, timezone
  // move) does not trigger a compose loop.
  return s.lastBriefDay < s.today;
}
