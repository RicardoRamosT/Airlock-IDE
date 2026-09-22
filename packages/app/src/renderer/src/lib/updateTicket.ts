// One line of the Update ticket: a version, plus when that build was made when
// we know it.
//
// Formatted by hand rather than through Intl/toLocale*: the output is then the
// same on every machine, which is what makes it testable without pinning a
// timezone or a locale. The app is English-only, so the three-letter months
// cost nothing.

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * `builtAt` is absent on the GitHub release path (a published release has a
 * version and nothing else useful here), and present on the dev channel, where
 * BOTH versions are the same number and the timestamp is the only thing that
 * distinguishes the build you are running from the one on offer.
 *
 * A build from today shows a clock time; anything older shows a date, because
 * "built 11:42" on yesterday's build reads as minutes ago.
 */
export function ticketLine(
  version: string | null,
  builtAt?: number | null,
  now: number = Date.now(),
): string {
  const label = version?.trim() ? version : "unknown";
  // 0 and NaN are what an unset or unparsed timestamp looks like; printing
  // "built Jan 1 1970" from one would be worse than printing nothing.
  if (typeof builtAt !== "number" || !Number.isFinite(builtAt) || builtAt <= 0)
    return label;
  const d = new Date(builtAt);
  const n = new Date(now);
  const sameDay =
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate();
  const when = sameDay
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${MONTHS[d.getMonth()] ?? ""} ${d.getDate()}`;
  return `${label} · built ${when}`;
}
