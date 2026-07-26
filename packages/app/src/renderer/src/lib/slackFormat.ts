// packages/app/src/renderer/src/lib/slackFormat.ts
// Pure timestamp formatting for the Slack sidebar. Renderer-local ON PURPOSE:
// the renderer must never value-import @airlock/agent-core (its barrel pulls in
// native deps and breaks the browser build), so renderer-facing pure helpers
// live here -- same as lib/quotaFormat.ts.

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

const pad = (n: number): string => String(n).padStart(2, "0");

// Slack ts is "<epoch seconds>.<counter>" -- seconds, NOT milliseconds.
function dateOf(ts: string): Date | null {
  const seconds = Number.parseFloat(ts);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatSlackTime(ts: string, now: Date): string {
  const d = dateOf(ts);
  if (!d) return "";
  return sameDay(d, now)
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// Day-separator label for a chat transcript: "Today" / "Yesterday" / "Jul 25".
export function formatDayLabel(ts: string, now: Date): string {
  const d = dateOf(ts);
  if (!d) return "";
  if (sameDay(d, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  const year =
    d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${year}`;
}

// Which calendar day a ts falls on, for detecting separator boundaries.
export function dayKey(ts: string): string {
  const d = dateOf(ts);
  if (!d) return "";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Up to two initials for an avatar. Strips the "(DM)" suffix the allow-list
// adds to conversation labels so a DM avatar reads as the person, not "R(".
export function initialsFor(name: string): string {
  const clean = name.replace(/\s*\((DM|group)\)\s*$/i, "").trim();
  if (!clean) return "?";
  const words = clean.split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => [...w][0] ?? "");
  return letters.join("").toUpperCase() || "?";
}

// Stable hue per author so the same person keeps one avatar colour across
// renders and channels. Deterministic (no Math.random) -> testable.
export function avatarHue(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}
