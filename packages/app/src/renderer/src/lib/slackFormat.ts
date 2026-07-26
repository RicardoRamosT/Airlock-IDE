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
export function formatSlackTime(ts: string, now: Date): string {
  const seconds = Number.parseFloat(ts);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const d = new Date(seconds * 1000);
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
