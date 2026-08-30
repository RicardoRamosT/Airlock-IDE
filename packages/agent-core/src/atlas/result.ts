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

// The CLI prints one JSON object. Scan from the first '{' so a stray stdout
// line cannot break the parse.
function extractJson(raw: string): unknown {
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
