// What Atlas is DOING right now, derived from the CLI's streamed events.
//
// Before this, a chat turn was a spinner and a timer. A run doing genuine
// multi-step work looked exactly like a run that had wedged, which is how a
// fifteen-minute session came to be killed with nobody able to say whether it
// had been making progress. `--output-format stream-json` emits an event per
// step, so the answer is already on the wire; this turns it into one line a
// person can read.
//
// Pure and defensive: the shapes come from another program, so every field is
// checked rather than trusted, and anything unrecognised yields null (skipped)
// instead of a half-rendered row.

export interface AtlasActivity {
  // "Bash", "Read", "WebSearch", "open_tab"...
  tool: string;
  // The one argument worth showing: the command, the path, the query.
  detail: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// One line, bounded. A command can be a whole script; the panel is ~320px.
function clip(s: string, max = 160): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// MCP tools arrive as mcp__airlock__open_tab. The prefix is noise to a reader
// who already knows they are looking at AirLock.
function shortToolName(name: string): string {
  const m = /^mcp__[^_]+__(.+)$/.exec(name);
  return m ? (m[1] as string) : name;
}

// The argument a person would actually want to see, per tool. Falls back to the
// first short string in the input, so a tool this does not know about still
// says something useful instead of nothing.
function detailFor(tool: string, input: Record<string, unknown>): string {
  const direct =
    str(input.command) ||
    str(input.file_path) ||
    str(input.path) ||
    str(input.query) ||
    str(input.pattern) ||
    str(input.url) ||
    str(input.prompt);
  if (direct) return clip(direct);
  for (const v of Object.values(input)) {
    if (typeof v === "string" && v.length > 0 && v.length < 200) return clip(v);
  }
  return "";
}

// Returns every tool call in one streamed event. An assistant message can carry
// several blocks, and dropping the extras would under-report parallel work.
export function activityFromEvent(event: unknown): AtlasActivity[] {
  if (!event || typeof event !== "object") return [];
  const e = event as Record<string, unknown>;
  if (e.type !== "assistant") return [];
  const message = e.message;
  if (!message || typeof message !== "object") return [];
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];

  const out: AtlasActivity[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type !== "tool_use") continue;
    const name = str(b.name);
    if (name.length === 0) continue;
    const input =
      b.input && typeof b.input === "object"
        ? (b.input as Record<string, unknown>)
        : {};
    out.push({ tool: shortToolName(name), detail: detailFor(name, input) });
  }
  return out;
}

// Parse one NDJSON line into activities. Invalid JSON yields nothing: a stream
// can be cut mid-line, and a partial line is not an error worth surfacing.
export function activityFromLine(line: string): AtlasActivity[] {
  const trimmed = line.trim();
  if (trimmed.length === 0 || !trimmed.startsWith("{")) return [];
  try {
    return activityFromEvent(JSON.parse(trimmed));
  } catch {
    return [];
  }
}

// Split a growing buffer into COMPLETE lines, returning the remainder. A chunk
// boundary can fall anywhere, including mid-JSON, so a parser that assumed one
// chunk was one line would drop events at random.
export function splitLines(buffer: string): {
  lines: string[];
  rest: string;
} {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts, rest };
}
