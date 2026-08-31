// ASCII comments only. Parse `claude -p --output-format json` output.
//
// Tolerant on purpose. A failed compose must leave yesterday's brief in place
// rather than replace it with an empty one -- a blank popover reads as a crash,
// and the whole point of Atlas is that the user can trust what it shows.

export interface ComposerResult {
  text: string;
  costUsd: number;
  durationMs: number;
}

// TWO output formats reach this parser, and it accepts both.
//
// `--output-format json` (the daily brief) prints ONE object at the end.
// `--output-format stream-json` (the chat) prints NDJSON: a line per event,
// the last of which is `{"type":"result",...}` carrying the very same fields.
// The chat streams because a silent process cannot be told apart from a wedged
// one -- see the idle deadline in composer.ts.
//
// Try NDJSON first: a stream ends with the result line, and slicing from the
// FIRST '{' to EOF (which is what the single-object path does) would hand
// JSON.parse a whole concatenated stream and fail.
function extractJson(raw: string): unknown {
  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? "").trim();
    if (line.length === 0 || !line.startsWith("{")) continue;
    try {
      const d = JSON.parse(line) as Record<string, unknown>;
      // Only the result event carries the reply; ignore assistant/system lines.
      if (d.type === "result") return d;
    } catch {
      // Not a complete JSON line (a truncated stream, say). Keep scanning up.
    }
  }
  // Single-object form. Scan from the first '{' so a stray stdout line -- a
  // shell notice, a warning -- cannot break the parse.
  const start = raw.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(raw.slice(start));
  } catch {
    return null;
  }
}

export function parseComposerOutput(raw: string): ComposerResult | null {
  const parsed = extractJson(raw);
  if (parsed === null || typeof parsed !== "object") return null;
  const d = parsed as Record<string, unknown>;

  if (d.is_error === true) return null;
  const text = typeof d.result === "string" ? d.result.trim() : "";
  if (text.length === 0) return null;

  let costUsd = 0;
  const usage = d.modelUsage;
  if (usage && typeof usage === "object") {
    for (const entry of Object.values(usage as Record<string, unknown>)) {
      if (entry && typeof entry === "object") {
        const c = (entry as Record<string, unknown>).costUSD;
        if (typeof c === "number" && Number.isFinite(c)) costUsd += c;
      }
    }
  }

  const durationMs =
    typeof d.duration_ms === "number" && Number.isFinite(d.duration_ms)
      ? d.duration_ms
      : 0;

  return { text, costUsd, durationMs };
}
